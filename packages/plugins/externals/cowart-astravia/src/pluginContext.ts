import type { PluginContext } from "@astravia-org/plugin-sdk";

let pluginContext: PluginContext | null = null;

export function setPluginContext(ctx: PluginContext): void {
	pluginContext = ctx;
}

export function getPluginContext(): PluginContext | null {
	return pluginContext;
}
