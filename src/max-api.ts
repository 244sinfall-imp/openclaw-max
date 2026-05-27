import { Bot } from "@maxhub/max-bot-api";
import type { MaxAccountConfig } from "./config.js";
import { resolveToken, tokenFor } from "./config.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

export type MaxApi = InstanceType<typeof Bot>["api"];

type Cached = { bot: Bot; api: MaxApi };
const cache = new Map<string, Cached>();

export function getBot(account: MaxAccountConfig): Cached {
  return getBotForToken(tokenFor(account));
}

export async function getBotResolved(cfg: OpenClawConfig, account: MaxAccountConfig): Promise<Cached> {
  const token = await resolveToken(cfg, account);
  if (!token) throw new Error(`Max account ${account.accountId} missing token`);
  return getBotForToken(token);
}

function getBotForToken(token: string): Cached {
  let cached = cache.get(token);
  if (!cached) {
    const bot = new Bot(token);
    cached = { bot, api: bot.api };
    cache.set(token, cached);
  }
  return cached;
}

export function toIntId(value: string | number): number {
  const raw = String(value).replace(/^(max:|chat:|user:|group:)/i, "").trim();
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`Invalid Max numeric id: ${value}`);
  return n;
}

export function messageIdOf(value: unknown): string | undefined {
  const v = value as { body?: { mid?: string }; message_id?: string; id?: string; mid?: string } | undefined;
  return v?.body?.mid ?? v?.message_id ?? v?.id ?? v?.mid;
}

export async function sendText(api: MaxApi, to: string | number, text: string, extra?: Record<string, unknown>): Promise<unknown> {
  return api.sendMessageToChat(toIntId(to), text, extra as never);
}

export async function sendToUser(api: MaxApi, userId: string | number, text: string, extra?: Record<string, unknown>): Promise<unknown> {
  return api.sendMessageToUser(toIntId(userId), text, extra as never);
}
