import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { agentBlueprintRegistry } from "./agent-blueprint-registry.js";
import { buildPluginAgentPresets } from "./plugin-agent-presets.js";

/** monorepo 里随宿主发布的预设插件源码目录。 */
const PRESET_PLUGIN_DIR = resolve(import.meta.dirname, "../../../../../packages/plugins/presets/preset-agent");

/**
 * 按真实 manifest 把一个预设插件注册进 blueprint 注册表，供依赖预设资源的测试使用。
 *
 * 宿主自己不带人设：智能体与团队都要等提供方就位才解析得出来。产品里这一步由
 * initPluginAgentPresetSync 在插件目录就绪时完成，测试里没有插件目录，于是直接读源码目录
 * ——顺带让 manifest 与回填链路的对齐也被测到。插件 id 一律取自 manifest，不在宿主里写死。
 */
export function registerPresetPluginBlueprints(pluginDir: string = PRESET_PLUGIN_DIR): void {
	const manifest = JSON.parse(readFileSync(join(pluginDir, "plugin.json"), "utf8")) as {
		id: string;
		defaultLocale?: string;
		agent?: InstalledPlugin["agent"];
	};
	const locales = Object.fromEntries(
		["zh", "en"].map((locale) => [
			locale,
			JSON.parse(readFileSync(join(pluginDir, "locales", `${locale}.json`), "utf8")) as Record<string, string>,
		]),
	);
	const plugin = {
		id: manifest.id,
		enabled: true,
		defaultLocale: manifest.defaultLocale,
		locales,
		rootPath: pluginDir,
		agent: manifest.agent,
	} as unknown as InstalledPlugin;
	const { agents, teams } = buildPluginAgentPresets({ plugins: [plugin], logger: { warn: () => {} } });
	agentBlueprintRegistry.replacePluginPresets(agents, teams, [manifest.id]);
}
