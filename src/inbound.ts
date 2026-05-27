import type { OpenClawConfig, PluginRuntime, ReplyPayload } from "openclaw/plugin-sdk/core";
type ChannelLogSink = { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void; debug?: (msg: string) => void };
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { resolveStorePath } from "openclaw/plugin-sdk/config-runtime";
import type { MaxAccountConfig } from "./config.js";
import { CHANNEL_ID, isAllowedSender } from "./config.js";
import { deliverReply } from "./outbound.js";
import { getBotResolved } from "./max-api.js";

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
  if (update.update_type === "bot_started") {
    return {
      sender: update.user,
      recipient: { chat_id: update.chat_id, chat_type: "dialog" },
      timestamp: update.timestamp,
      body: { mid: `bot_started:${update.timestamp}:${update.user?.user_id ?? update.chat_id}`, text: "/start" },
    };
  }
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
  const chatId = recipient?.chat_id ?? recipient?.id ?? msg.chat_id ?? msg.dialog_id ?? update.chat_id ?? senderId;
  if (senderId === undefined || chatId === undefined) return null;
  const typeRaw = String(recipient?.chat_type ?? recipient?.type ?? msg.chat_type ?? "").toLowerCase();
  const chatType = typeRaw.includes("dialog") ? "direct" : typeRaw.includes("chat") || typeRaw.includes("group") || String(chatId).startsWith("-") ? "group" : "direct";
  const messageId = msg.body?.mid ?? msg.mid ?? msg.id ?? update.update_id ?? `${chatId}:${Date.now()}`;
  return {
    updateId: String(update.update_id ?? `${update.update_type ?? "update"}:${update.timestamp ?? messageId}`),
    messageId: String(messageId),
    chatId: String(chatId),
    chatType,
    senderId: String(senderId),
    senderName: sender?.name ?? sender?.first_name ?? sender?.username,
    text,
    timestamp: typeof msg.timestamp === "number" ? msg.timestamp : typeof update.timestamp === "number" ? update.timestamp : Date.now(),
  };
}

async function safeSendAction(cfg: OpenClawConfig, account: MaxAccountConfig, chatId: string, action: "mark_seen" | "typing_on", log?: ChannelLogSink) {
  try {
    const { api } = await getBotResolved(cfg, account);
    await api.sendAction(Number(chatId), action);
  } catch (err) {
    log?.debug?.(`[${account.accountId}] Max ${action} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function handleUpdate(params: {
  cfg: OpenClawConfig;
  account: MaxAccountConfig;
  runtime: PluginRuntime;
  log?: ChannelLogSink;
  update: unknown;
}) {
  const inbound = normalize(params.update as AnyUpdate);
  const { cfg, account, runtime, log } = params;
  if (!inbound) {
    log?.debug?.(`[${account.accountId}] ignored Max update: ${JSON.stringify(params.update).slice(0, 500)}`);
    return;
  }
  log?.info?.(`[${account.accountId}] Max inbound ${inbound.chatType} from ${inbound.senderId}: ${inbound.text.slice(0, 80)}`);
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
  await safeSendAction(cfg, account, inbound.chatId, "mark_seen", log);
  await safeSendAction(cfg, account, inbound.chatId, "typing_on", log);
  const slashMatch = inbound.text.trim().match(/^\/([^\s@]+)/);
  const channelRuntime = (runtime as any).turn ? (runtime as any) : (runtime as any).channel;
  if (!channelRuntime?.turn?.buildContext || !channelRuntime?.turn?.runAssembled) {
    throw new Error(`Max inbound requires channel runtime turn helpers; runtime keys=${Object.keys(runtime as any).join(",")}, channel keys=${Object.keys(channelRuntime ?? {}).join(",")}`);
  }

  const ctxPayload = channelRuntime.turn.buildContext({
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
      to: inbound.chatType === "direct" ? `user:${inbound.senderId}` : `chat:${inbound.chatId}`,
      originatingTo: inbound.chatType === "direct" ? `user:${inbound.senderId}` : `chat:${inbound.chatId}`,
      nativeChannelId: inbound.chatId,
      replyTarget: inbound.chatType === "direct" ? `user:${inbound.senderId}` : `chat:${inbound.chatId}`,
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
    command: slashMatch ? {
      kind: "text-slash",
      name: slashMatch[1],
      body: inbound.text,
      authorized: true,
    } : undefined,
    access: {
      dm: { policy: account.dmPolicy ?? "allowlist", allowFrom: account.allowFrom ?? [], allowed: true },
      group: { policy: "open", routeAllowed: true, senderAllowed: true, mentioned: true, requireMention: false },
      mentions: { canDetect: false, mentioned: true },
      commands: { authorized: true },
    },
  } as any);

  await channelRuntime.turn.runAssembled({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    agentId: route.agentId,
    routeSessionKey: route.sessionKey,
    storePath,
    ctxPayload,
    recordInboundSession: channelRuntime.session.recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher: channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
    delivery: {
      deliver: async (payload: ReplyPayload) => {
        await deliverReply({ cfg, accountId: account.accountId, to: inbound.chatType === "direct" ? `user:${inbound.senderId}` : `chat:${inbound.chatId}`, payload });
      },
      onError: (err: unknown, info: { kind: string }) => log?.error?.(`max ${info.kind} reply failed: ${String(err)}`),
    },
    record: { onRecordError: (err: unknown) => log?.error?.(`max record failed: ${String(err)}`) },
  } as any);
}
