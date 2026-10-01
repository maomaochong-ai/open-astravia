import type { PluginContext } from "@astravia-org/plugin-sdk";

export function applyStudioPanelWidth(ctx: PluginContext, active: boolean): void {
	if (active) ctx.ui.setActivityPanelWidth("max");
}
