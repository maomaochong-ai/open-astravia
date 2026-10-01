import type { PluginContext } from "@astravia-org/plugin-sdk";

let pluginContext: PluginContext | null = null;

export function setPluginContext(ctx: PluginContext): void {
	pluginContext = ctx;
}

export function getPluginContext(): PluginContext {
	if (!pluginContext) throw new Error("Remotion renderer plugin is not active");
	return pluginContext;
}
