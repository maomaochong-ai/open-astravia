import { normalizePluginAgentModes } from "@vetta-org/plugin-sdk/manifest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";

/** ADR-0046 plugin-level hard gate. Undefined mode and undeclared modes remain unrestricted. */
export function pluginVisibleInAgentMode(
	plugin: Pick<InstalledPlugin, "agent_mode">,
	mode: string | undefined,
): boolean {
	if (mode === undefined) return true;
	const declared = normalizePluginAgentModes(plugin.agent_mode);
	if (!declared || declared.length === 0) return true;
	return declared.includes(mode);
}
