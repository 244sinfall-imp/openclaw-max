import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { maxChannel } from "./channel.js";
import { registerMaxTools } from "./tools.js";

export const plugin: any = defineChannelPluginEntry({
  id: "openclaw-max",
  name: "Max Messenger",
  description: "Modern OpenClaw channel plugin for Max Messenger Bot API.",
  plugin: maxChannel,
  registerFull(api: OpenClawPluginApi) {
    registerMaxTools(api);
  },
});

export default plugin;
