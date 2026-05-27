import type { OpenClawConfig, PluginRuntime, ReplyPayload } from "openclaw/plugin-sdk/core";
type ChannelLogSink = { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void; debug?: (msg: string) => void };
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { resolveStorePath } from "openclaw/plugin-sdk/config-runtime";
import type { MaxAccountConfig } from "./config.js";
import { CHANNEL_ID, isAllowedSender } from "./config.js";
import { deliverReply } from "./outbound.js";

type AnyUpdate = Record<string, any>;

type NormalizedInbound = {
  updateId: string;
  messageId: string;
  chatId: string;
  chatType: "direct" | "group";
  senderId: string;
  senderName?: string;
  text: string;
  timestamp?: number;
};

function pickMessage(update: AnyUpdate): any | undefined {
  return update.message ?? update.body?.message ?? update.body ?? update.message_created?.message ?? update.message_edited?.message;
}

function normalize(update: AnyUpdate): NormalizedInbound | null {
  const msg = pickMessage(update);
  if (!msg) return null;
  const text = msg.body?.text ?? msg.text ?? msg.message?.text ?? "";
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const sender = msg.sender ?? msg.from ?? msg.user ?? update.user ?? update.sender;
  const recipient = msg.recipient ?? msg.chat ?? msg.dialog ?? update.chat;
  const senderId = sender?.user_id ?? sender?.id ?? msg.user_id ?? update.user_id;
  const chatId = recipient?.chat_id ?? recipient?.id ?? msg.chat_id ?? msg.dialog_id ?? senderId;
  if (senderId === undefined || chatId === undefined) return null;
  const typeRaw = String(recipient?.type ?? msg.chat_type ?? "").toLowerCase();
  const chatType = typeRaw.includes("chat") || typeRaw.includes("group") || String(chatId).startsWith("-") ? "group" : "direct";
  const messageId = msg.body?.mid ?? msg.mid ?? msg.id ?? update.update_id ?? `${chatId}:${Date.now()}`;
  return {
    updateId: String(update.update_id ?? messageId),
    messageId: String(messageId),
    chatId: String(chatId),
    chatType,
    senderId: String(senderId),
    senderName: sender?.name ?? sender?.first_name ?? sender?.username,
    text,
    timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
  };
}

export async function handleUpdate(params: {
  cfg: OpenClawConfig;
  account: MaxAccountConfig;
  runtime: PluginRuntime;
  log?: ChannelLogSink;
  update: unknown;
}) {
  const inbound = normalize(params.update as AnyUpdate);
  if (!inbound) return;
  const { cfg, account, runtime, log } = params;
  if (inbound.chatType === "direct") {
    if (account.dmPolicy === "block") return;
    if (account.dmPolicy !== "open" && !isAllowedSender(account, inbound.senderId)) {
      log?.warn?.(`[${account.accountId}] blocked Max DM from ${inbound.senderId}`);
      return;
    }
  }
  const peer = { kind: inbound.chatType, id: inbound.chatType === "direct" ? inbound.senderId : inbound.chatId } as const;
  const route = resolveAgentRoute({ cfg, channel: CHANNEL_ID, accountId: account.accountId, peer });
  const storePath = resolveStorePath((cfg as any).store, { agentId: route.agentId });
  const ctxPayload = runtime.channel.turn.buildContext({
    channel: CHANNEL_ID,
    accountId: account.accountId,
    messageId: inbound.messageId,
    timestamp: inbound.timestamp,
    from: `max:${inbound.senderId}`,
    sender: {
      id: inbound.senderId,
      name: inbound.senderName,
      displayLabel: inbound.senderName ? `${inbound.senderName} (${inbound.senderId})` : inbound.senderId,
    },
    conversation: {
      kind: inbound.chatType,
      id: peer.id,
      label: inbound.chatType === "direct" ? `Max DM ${inbound.senderId}` : `Max chat ${inbound.chatId}`,
      routePeer: peer,
    },
    route: {
      agentId: route.agentId,
      accountId: account.accountId,
      routeSessionKey: route.sessionKey,
      createIfMissing: true,
    },
    reply: {
      to: inbound.chatId,
      originatingTo: inbound.chatId,
      nativeChannelId: inbound.chatId,
      replyTarget: inbound.chatId,
      replyToId: inbound.messageId,
      sourceReplyDeliveryMode: "direct",
    },
    message: {
      body: inbound.text,
      rawBody: inbound.text,
      bodyForAgent: inbound.text,
      commandBody: inbound.text,
      envelopeFrom: inbound.senderName ?? inbound.senderId,
      preview: inbound.text.slice(0, 160),
    },
    access: {
      dm: { policy: account.dmPolicy ?? "allowlist", allowFrom: account.allowFrom ?? [], allowed: true },
      group: { policy: "open", routeAllowed: true, senderAllowed: true, mentioned: true, requireMention: false },
      mentions: { canDetect: false, mentioned: true },
    },
  } as any);

  await runtime.channel.turn.runAssembled({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    agentId: route.agentId,
    routeSessionKey: route.sessionKey,
    storePath,
    ctxPayload,
    recordInboundSession: runtime.channel.session.recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher: runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
    delivery: {
      deliver: async (payload: ReplyPayload) => {
        await deliverReply({ cfg, accountId: account.accountId, to: inbound.chatId, payload });
      },
      onError: (err: unknown, info: { kind: string }) => log?.error?.(`max ${info.kind} reply failed: ${String(err)}`),
    },
    record: { onRecordError: (err: unknown) => log?.error?.(`max record failed: ${String(err)}`) },
  } as any);
}
