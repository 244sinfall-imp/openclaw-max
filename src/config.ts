import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { SecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { isSecretRef } from "openclaw/plugin-sdk/core";
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/config-runtime";

export const CHANNEL_ID = "max";
export const DEFAULT_ACCOUNT_ID = "default";

export type MaxAccountConfig = {
  accountId: string;
  enabled: boolean;
  token?: SecretInput;
  dmPolicy?: "open" | "allowlist" | "pairing" | "block";
  allowFrom?: Array<string | number>;
  polling?: { intervalMs?: number; limit?: number; marker?: number | null };
  textChunkLimit?: number;
};

export type MaxConfig = {
  enabled?: boolean;
  token?: SecretInput;
  dmPolicy?: MaxAccountConfig["dmPolicy"];
  allowFrom?: Array<string | number>;
  polling?: MaxAccountConfig["polling"];
  textChunkLimit?: number;
  accounts?: Record<string, Omit<Partial<MaxAccountConfig>, "accountId">>;
};

export function resolveEnvToken(raw?: SecretInput): string | undefined {
  if (!raw) return undefined;
  if (isSecretRef(raw)) {
    if (raw.source === "env") return process.env[raw.id];
    return undefined;
  }
  const match = raw.match(/^\$\{([A-Z0-9_]+)\}$/i);
  return match ? process.env[match[1]] : raw;
}

export async function resolveToken(cfg: OpenClawConfig, account: MaxAccountConfig): Promise<string | undefined> {
  const resolved = await resolveConfiguredSecretInputString({
    config: cfg,
    env: process.env,
    value: account.token,
    path: `channels.max.accounts.${account.accountId}.token`,
    unresolvedReasonStyle: "detailed",
  });
  return resolved.value ?? resolveEnvToken(account.token);
}

export function maxConfig(cfg: OpenClawConfig): MaxConfig {
  return ((cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID] ?? {}) as MaxConfig;
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const section = maxConfig(cfg);
  const ids = Object.keys(section.accounts ?? {});
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

export function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): MaxAccountConfig {
  const section = maxConfig(cfg);
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const account = section.accounts?.[id] ?? {};
  const token = account.token ?? section.token ?? "${MAX_BOT_TOKEN}";
  return {
    accountId: id,
    enabled: account.enabled ?? section.enabled ?? true,
    token,
    dmPolicy: account.dmPolicy ?? section.dmPolicy ?? "allowlist",
    allowFrom: account.allowFrom ?? section.allowFrom ?? [],
    polling: { ...(section.polling ?? {}), ...(account.polling ?? {}) },
    textChunkLimit: account.textChunkLimit ?? section.textChunkLimit ?? 3900,
  };
}

export function normalizedAllowEntry(raw: string | number): string {
  return String(raw).replace(/^(max:|user:)/i, "").trim();
}

export function isAllowedSender(account: MaxAccountConfig, senderId: string | number): boolean {
  const sender = String(senderId);
  return (account.allowFrom ?? []).some((entry) => normalizedAllowEntry(entry) === sender);
}

export function tokenFor(account: MaxAccountConfig): string {
  const token = resolveEnvToken(account.token);
  if (!token) throw new Error(`Max account ${account.accountId} missing token`);
  return token;
}
