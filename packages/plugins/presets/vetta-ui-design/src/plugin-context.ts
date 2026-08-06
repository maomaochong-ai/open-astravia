import type { PluginContext, PluginUiApi } from "@vetta-org/plugin-sdk";

let pluginCtx: PluginContext | null = null;

export function setPluginCtx(ctx: PluginContext): void {
	pluginCtx = ctx;
}

export function getPluginCtx(): PluginContext {
	if (!pluginCtx) throw new Error("vetta-ui-design plugin context not ready");
	return pluginCtx;
}

export function notify(options: Parameters<PluginUiApi["notify"]>[0]): void {
	pluginCtx?.ui.notify(options);
}
