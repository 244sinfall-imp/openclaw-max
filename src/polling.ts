import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
type ChannelLogSink = { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void; debug?: (msg: string) => void };
import type { MaxAccountConfig } from "./config.js";
import { getBotResolved } from "./max-api.js";
import { handleUpdate } from "./inbound.js";

type Poller = { stop: () => void; marker?: number | null; running: boolean };
const pollers = new Map<string, Poller>();

export function stopPolling(accountId?: string) {
  if (accountId) {
    pollers.get(accountId)?.stop();
    pollers.delete(accountId);
    return;
  }
  for (const p of pollers.values()) p.stop();
  pollers.clear();
}

export async function startPolling(params: {
  cfg: OpenClawConfig;
  account: MaxAccountConfig;
  runtime: PluginRuntime;
  log?: ChannelLogSink;
  abortSignal: AbortSignal;
}) {
  const { cfg, account, runtime, log, abortSignal } = params;
  if (!account.enabled) return;
  stopPolling(account.accountId);
  const { api } = await getBotResolved(cfg, account);
  const intervalMs = account.polling?.intervalMs ?? 1500;
  const limit = account.polling?.limit ?? 50;
  let marker = account.polling?.marker ?? undefined;
  let stopped = false;
  const poller: Poller = { running: false, marker, stop: () => { stopped = true; } };
  pollers.set(account.accountId, poller);
  abortSignal.addEventListener("abort", () => poller.stop(), { once: true });
  log?.info?.(`[${account.accountId}] Max polling started`);

  while (!stopped && !abortSignal.aborted) {
    if (poller.running) {
      await sleep(Math.max(intervalMs, 100));
      continue;
    }
    poller.running = true;
    try {
      const res = await api.getUpdates(["message_created", "bot_started"] as never, { marker, limit } as never);
      const updates = (res as { updates?: unknown[]; marker?: number | null })?.updates ?? [];
      const nextMarker = (res as { marker?: number | null })?.marker;
      if (nextMarker !== undefined && nextMarker !== null) marker = nextMarker;
      poller.marker = marker;
      if (updates.length > 0) log?.info?.(`[${account.accountId}] Max received ${updates.length} update(s), marker=${String(marker)}`);
      for (const update of updates) {
        await handleUpdate({ cfg, account, runtime, log, update });
      }
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
      log?.error?.(`[${account.accountId}] Max polling error: ${detail}`);
      await sleep(Math.max(intervalMs, 5000));
    } finally {
      poller.running = false;
    }
    await sleep(intervalMs);
  }
  log?.info?.(`[${account.accountId}] Max polling stopped`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
