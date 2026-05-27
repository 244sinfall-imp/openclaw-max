import { stripChannelTargetPrefix } from "openclaw/plugin-sdk/core";
import type { ChannelOutboundAdapter, ReplyPayload } from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getBot, getBotResolved, messageIdOf, sendText, sendToUser } from "./max-api.js";
import { CHANNEL_ID, resolveAccount } from "./config.js";

type MaxApi = ReturnType<typeof getBot>["api"];

function targetOf(raw: string): { id: string; kind: "user" | "chat" } {
  const stripped = stripChannelTargetPrefix(raw, "max").trim();
  const user = /^(user:|dm:)/i.test(stripped);
  const chat = /^(chat:|group:)/i.test(stripped);
  const id = stripped.replace(/^(chat:|user:|group:|dm:)/i, "").trim();
  return { id, kind: user || !chat ? "user" : "chat" };
}

async function sendTarget(api: MaxApi, raw: string, text: string) {
  const target = targetOf(raw);
  return target.kind === "user" ? sendToUser(api, target.id, text) : sendText(api, target.id, text);
}

function textFromPayload(payload: ReplyPayload): string {
  const direct = typeof payload.text === "string" ? payload.text : "";
  return direct || " ";
}

export async function deliverReply(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  to: string;
  payload: ReplyPayload;
}) {
  const account = resolveAccount(params.cfg, params.accountId);
  const { api } = await getBotResolved(params.cfg, account);
  const result = await sendTarget(api, params.to, textFromPayload(params.payload));
  return { messageId: messageIdOf(result) ?? undefined };
}

export const outbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 3900,
  deliveryCapabilities: { pin: true, durableFinal: { text: true, media: true, payload: true, silent: true, replyTo: true } },
  presentationCapabilities: { supported: false, limits: { text: { maxLength: 3900, markdownDialect: "markdown" } } },
  resolveTarget: ({ to }) => {
    const target = targetOf(to ?? "");
    if (!target.id) return { ok: false, error: new Error("Max target is required") };
    return { ok: true, to: `${target.kind}:${target.id}` };
  },
  sendPayload: async ({ cfg, to, payload, accountId }) => {
    const account = resolveAccount(cfg, accountId);
    const { api } = await getBotResolved(cfg, account);
    const target = targetOf(to);
    const result = await sendTarget(api, to, textFromPayload(payload));
    return { channel: CHANNEL_ID, messageId: messageIdOf(result) ?? "", conversationId: target.id };
  },
  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveAccount(cfg, accountId);
    const { api } = await getBotResolved(cfg, account);
    const target = targetOf(to);
    const result = await sendTarget(api, to, text);
    return { channel: CHANNEL_ID, messageId: messageIdOf(result) ?? "", conversationId: target.id };
  },
  sendMedia: async ({ cfg, to, text, accountId }) => {
    const account = resolveAccount(cfg, accountId);
    const { api } = await getBotResolved(cfg, account);
    const target = targetOf(to);
    const result = await sendTarget(api, to, text || "[media attachment]");
    return { channel: CHANNEL_ID, messageId: messageIdOf(result) ?? "", conversationId: target.id };
  },
};
