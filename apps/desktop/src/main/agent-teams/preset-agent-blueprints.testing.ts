import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRESET_AGENT_PLUGIN_ID } from "@vetta/agent-team";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { agentBlueprintRegistry } from "./agent-blueprint-registry.js";
import { buildPluginAgentPresets } from "./plugin-agent-presets.js";

/** monorepo 里「预设智能体」插件的源码目录。 */
const PRESET_AGENT_ROOT = resolve(import.meta.dirname, "../../../../../packages/plugins/presets/preset-agent");

/**
 * 按真实 manifest 把「预设智能体」注册进 blueprint 注册表，供依赖装机资源的测试使用。
 *
 * master / developer / researcher 已经是插件智能体：装机目录里的那几份档案要能解析出人设，
 * 前提就是这个插件在位。产品里这一步由 initPluginAgentPresetSync 在插件目录就绪时完成，
 * 测试里没有插件目录，于是直接读源码目录——顺带让 manifest 与装机资源的对齐也被测到。
 */
export function registerPresetAgentBlueprints(): void {
	const manifest = JSON.parse(readFileSync(join(PRESET_AGENT_ROOT, "plugin.json"), "utf8")) as {
		defaultLocale?: string;
		agent?: InstalledPlugin["agent"];
	};
	const locales = Object.fromEntries(
		["zh", "en"].map((locale) => [
			locale,
			JSON.parse(readFileSync(join(PRESET_AGENT_ROOT, "locales", `${locale}.json`), "utf8")) as Record<
				string,
				string
			>,
		]),
	);
	const plugin = {
		id: PRESET_AGENT_PLUGIN_ID,
		enabled: true,
		defaultLocale: manifest.defaultLocale,
		locales,
		rootPath: PRESET_AGENT_ROOT,
		agent: manifest.agent,
	} as unknown as InstalledPlugin;
	const { agents, teams } = buildPluginAgentPresets({ plugins: [plugin], logger: { warn: () => {} } });
	agentBlueprintRegistry.replacePluginPresets(agents, teams, [PRESET_AGENT_PLUGIN_ID]);
}
