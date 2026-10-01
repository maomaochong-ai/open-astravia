import type { PluginContext } from "@astravia-org/plugin-sdk";

// activate 时持有 ctx，供组件调用 conversation API（插件 tab 组件零 props，
// ctx 只在 activate 入参出现）。

let pluginCtx: PluginContext | null = null;

export function setPluginCtx(ctx: PluginContext): void {
	pluginCtx = ctx;
}

export function getPluginCtx(): PluginContext | null {
	return pluginCtx;
}
