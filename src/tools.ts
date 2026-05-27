import { Type } from "typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext, OpenClawConfig } from "openclaw/plugin-sdk/core";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { resolveAccount } from "./config.js";
import { getBotResolved, sendText, toIntId } from "./max-api.js";

type Params = Record<string, unknown>;
function cfgOf(ctx: OpenClawPluginToolContext): OpenClawConfig { return (ctx.runtimeConfig ?? ctx.getRuntimeConfig?.() ?? ctx.config ?? {}) as OpenClawConfig; }
function accountId(p: Params): string | undefined { return typeof p.accountId === "string" ? p.accountId : undefined; }
function str(p: Params, key: string): string { const v = p[key]; if (typeof v !== "string" && typeof v !== "number") throw new Error(`${key} is required`); return String(v); }
function optStr(p: Params, key: string): string | undefined { const v = p[key]; return typeof v === "string" || typeof v === "number" ? String(v) : undefined; }
function num(p: Params, key: string): number { return toIntId(str(p, key)); }
async function apiFor(ctx: OpenClawPluginToolContext, p: Params) { const cfg = cfgOf(ctx); return (await getBotResolved(cfg, resolveAccount(cfg, accountId(p)))).api as any; }

const accountIdParam = Type.Optional(Type.String({ description: "Max account id" }));
const idParam = Type.Union([Type.String(), Type.Number()]);
const base = { accountId: accountIdParam };

export const maxToolsPlugin = defineToolPlugin({
  id: "openclaw-max-tools",
  name: "Max Messenger Tools",
  description: "Agent tools for Max Messenger Bot API.",
  tools: (tool) => {
    const t = (name: string, description: string, props: Record<string, any>, fn: (a: any, p: Params, ctx: OpenClawPluginToolContext) => Promise<unknown> | unknown) => tool({
      name,
      label: name.replace(/^max_/, "Max ").replace(/_/g, " "),
      description,
      parameters: Type.Object({ ...base, ...props }),
      factory: ({ toolContext }) => ({
        name,
        label: name.replace(/^max_/, "Max ").replace(/_/g, " "),
        description,
        parameters: Type.Object({ ...base, ...props }),
        optional: false,
        execute: async (_toolCallId: string, params: unknown) => fn(await apiFor(toolContext, params as Params), params as Params, toolContext),
      } as any),
    });
    return [
      t("max_get_me", "Get current Max bot identity.", {}, (a) => a.getMyInfo()),
      t("max_set_commands", "Set Max bot commands.", { commands: Type.Array(Type.Object({ name: Type.String(), description: Type.String() })) }, (a, p) => a.setMyCommands(p.commands ?? [])),
      t("max_get_chats", "List chats visible to the bot.", { count: Type.Optional(Type.Number()), marker: Type.Optional(Type.Number()) }, (a, p) => a.getAllChats({ count: p.count, marker: p.marker })),
      t("max_get_chat", "Get chat info.", { chatId: idParam }, (a, p) => a.getChat(num(p, "chatId"))),
      t("max_get_chat_by_link", "Get chat by link.", { link: Type.String() }, (a, p) => a.getChatByLink(str(p, "link"))),
      t("max_edit_chat", "Edit chat info.", { chatId: idParam, title: Type.Optional(Type.String()), icon: Type.Optional(Type.String()) }, (a, p) => a.editChatInfo(num(p, "chatId"), { title: p.title, icon: p.icon })),
      t("max_get_membership", "Get bot membership in chat.", { chatId: idParam }, (a, p) => a.getChatMembership(num(p, "chatId"))),
      t("max_get_admins", "List chat admins.", { chatId: idParam }, (a, p) => a.getChatAdmins(num(p, "chatId"))),
      t("max_get_members", "List chat members.", { chatId: idParam, userIds: Type.Optional(Type.Array(idParam)), count: Type.Optional(Type.Number()), marker: Type.Optional(Type.Number()) }, (a, p) => a.getChatMembers(num(p, "chatId"), { user_ids: (p.userIds as any[] | undefined)?.map(toIntId), count: p.count, marker: p.marker })),
      t("max_add_members", "Add members to chat.", { chatId: idParam, userIds: Type.Array(idParam) }, (a, p) => a.addChatMembers(num(p, "chatId"), (p.userIds as any[]).map(toIntId))),
      t("max_remove_member", "Remove member from chat.", { chatId: idParam, userId: idParam }, (a, p) => a.removeChatMember(num(p, "chatId"), num(p, "userId"))),
      t("max_leave_chat", "Leave chat.", { chatId: idParam }, (a, p) => a.leaveChat(num(p, "chatId"))),
      t("max_get_messages", "Get messages from chat.", { chatId: idParam, messageIds: Type.Optional(Type.Array(Type.String())) }, (a, p) => a.getMessages(num(p, "chatId"), { message_ids: p.messageIds })),
      t("max_get_message", "Get message by id.", { messageId: Type.String() }, (a, p) => a.getMessage(str(p, "messageId"))),
      t("max_send_message", "Send text message.", { chatId: idParam, text: Type.String() }, (a, p) => sendText(a, str(p, "chatId"), str(p, "text"))),
      t("max_edit_message", "Edit message text.", { messageId: Type.String(), text: Type.String() }, (a, p) => a.editMessage(str(p, "messageId"), { text: str(p, "text") })),
      t("max_delete_message", "Delete message.", { messageId: Type.String() }, (a, p) => a.deleteMessage(str(p, "messageId"))),
      t("max_pin_message", "Pin message.", { chatId: idParam, messageId: Type.String(), notify: Type.Optional(Type.Boolean()) }, (a, p) => a.pinMessage(num(p, "chatId"), str(p, "messageId"), { notify: Boolean(p.notify) })),
      t("max_unpin_message", "Unpin current pinned message.", { chatId: idParam }, (a, p) => a.unpinMessage(num(p, "chatId"))),
      t("max_get_pinned_message", "Get pinned message.", { chatId: idParam }, (a, p) => a.getPinnedMessage(num(p, "chatId"))),
      t("max_send_action", "Send chat action (typing/uploading).", { chatId: idParam, action: Type.String() }, (a, p) => a.sendAction(num(p, "chatId"), str(p, "action"))),
      t("max_answer_callback", "Answer callback query.", { callbackId: Type.String(), text: Type.Optional(Type.String()), notification: Type.Optional(Type.Boolean()) }, (a, p) => a.answerOnCallback(str(p, "callbackId"), { message: optStr(p, "text"), notification: p.notification })),
      t("max_upload_file", "Upload local file to Max and return attachment object.", { kind: Type.String(), path: Type.String() }, (a, p) => {
        const kind = str(p, "kind"); const path = str(p, "path");
        if (kind === "image") return a.uploadImage({ path });
        if (kind === "video") return a.uploadVideo({ path });
        if (kind === "audio") return a.uploadAudio({ path });
        return a.uploadFile({ path });
      }),
    ];
  },
});

export function registerMaxTools(api: OpenClawPluginApi) {
  maxToolsPlugin.register(api);
}
