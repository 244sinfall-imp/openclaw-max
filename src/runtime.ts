import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | undefined;

export function setPluginRuntime(next: PluginRuntime) {
  runtime = next;
}

export function resolvePluginRuntime(candidate?: unknown): PluginRuntime {
  const maybe = candidate as Partial<PluginRuntime> | undefined;
  if (maybe?.channel?.turn) return maybe as PluginRuntime;
  if (runtime?.channel?.turn) return runtime;
  throw new Error("Max plugin requires full OpenClaw PluginRuntime channel.turn helpers");
}
