import type { PluginContext } from "@astravia-org/plugin-sdk";

let pluginCtx: PluginContext | null = null;

export function setPluginCtx(ctx: PluginContext): void {
	pluginCtx = ctx;
}

export function getPluginCtx(): PluginContext {
	if (!pluginCtx) throw new Error("Security probe plugin context is not ready");
	return pluginCtx;
}
