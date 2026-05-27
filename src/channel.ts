import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-runtime";
import { CHANNEL_ID, listAccountIds, normalizedAllowEntry, resolveAccount, resolveEnvToken, type MaxAccountConfig } from "./config.js";
import { getBotResolved } from "./max-api.js";
import { outbound } from "./outbound.js";
import { startPolling, stopPolling } from "./polling.js";
import { resolvePluginRuntime } from "./runtime.js";

export const maxChannel: any = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: "Max Messenger",
      selectionLabel: "Max Messenger (Bot API)",
      docsPath: "/channels/max",
      docsLabel: "max",
      blurb: "Connect OpenClaw agents to Max Messenger via the Max Bot API.",
      aliases: ["max-messenger", "max.ru"],
      order: 91,
      markdownCapable: true,
      quickstartAllowFrom: true,
    },
    capabilities: { chatTypes: ["direct", "group"], media: true, edit: true, reply: true, reactions: false, threads: false },
    config: {
      listAccountIds,
      resolveAccount,
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => Boolean(resolveEnvToken(account.token) || account.token),
      unconfiguredReason: () => "Set channels.max.token or MAX_BOT_TOKEN.",
      resolveAllowFrom: ({ cfg, accountId }) => resolveAccount(cfg, accountId).allowFrom,
      formatAllowFrom: ({ allowFrom }) => allowFrom.map((v) => String(v)),
      hasConfiguredState: ({ cfg }) => listAccountIds(cfg).some((id) => Boolean(resolveAccount(cfg, id).token)),
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: Boolean(account.token),
        running: true,
        dmPolicy: account.dmPolicy,
        allowFrom: (account.allowFrom ?? []).map(String),
        tokenSource: typeof account.token === "string" && account.token.startsWith("${") ? account.token : account.token ? "config" : "missing",
      }),
    },
    status: {
      probeAccount: async ({ account, cfg }: { account: MaxAccountConfig; cfg: any }) => {
        const { api } = await getBotResolved(cfg, account);
        return api.getMyInfo();
      },
      formatCapabilitiesProbe: ({ probe }: { probe: unknown }) => [{ text: `Bot API reachable: ${JSON.stringify(probe).slice(0, 120)}`, tone: "success" as const }],
    },
    gateway: {
      startAccount: async (ctx) => {
        const pluginRuntime = resolvePluginRuntime(ctx.channelRuntime);
        const setStatus = createAccountStatusSink({ accountId: ctx.account.accountId, setStatus: ctx.setStatus });
        setStatus({ running: true, connected: false, lastStartAt: Date.now(), healthState: "starting" });
        try {
          setStatus({ connected: true, lastConnectedAt: Date.now(), healthState: "ok" });
          await startPolling({ cfg: ctx.cfg, account: ctx.account, runtime: pluginRuntime, log: ctx.log, abortSignal: ctx.abortSignal });
        } finally {
          setStatus({ running: false, connected: false, lastStopAt: Date.now(), healthState: "stopped" });
        }
      },
      stopAccount: async (ctx) => stopPolling(ctx.account.accountId),
    },
    agentPrompt: {
      messageToolHints: () => ["Max Messenger supports text DMs/groups and Max-specific management tools when enabled."],
      messageToolCapabilities: () => ["send text to Max user/chat ids", "inspect chats/members", "edit/delete/pin messages when bot permissions allow"],
      inboundFormattingHints: () => ({ text_markup: "plain/Markdown-like", rules: ["Keep messages concise; Max mobile UI is narrow."] }),
    },
  },
  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: (account) => account.dmPolicy,
      resolveAllowFrom: (account) => account.allowFrom,
      normalizeEntry: normalizedAllowEntry,
      defaultPolicy: "allowlist",
    },
  },
  pairing: {
    text: {
      idLabel: "maxUserId",
      message: "✅ OpenClaw access approved. Send a message to start chatting.",
      normalizeAllowEntry: normalizedAllowEntry,
      notify: async ({ id, message, cfg, accountId }) => {
        const account = resolveAccount(cfg, accountId);
        const { api } = await getBotResolved(cfg, account);
        await api.sendMessageToUser(Number(normalizedAllowEntry(id)), message);
      },
    },
  },
  outbound,
});
