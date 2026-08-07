import {
	type CodingAgentSessionResourceRuntimeOptions,
	createCodingAgentSessionResourceRuntime,
} from "../../host/coding-agent-resource-runtime.js";
import { CodingAgentPromptRuntime, type CodingAgentPromptRuntimeOptions } from "../../model-context/prompt-runtime.js";
import type { SessionResourceRuntime } from "../../resources/index.js";
import { SettingsRuntime } from "../../settings/index.js";

export interface CreateCodingAgentPromptRuntimeOptions
	extends Omit<CodingAgentPromptRuntimeOptions, "resourceLoader" | "settingsManager"> {
	readonly agentDir?: string;
	readonly resourceLoader?: SessionResourceRuntime;
	readonly settingsManager?: SettingsRuntime;
	readonly resourceLoaderOptions?: Omit<
		CodingAgentSessionResourceRuntimeOptions,
		"agentDir" | "cwd" | "noExtensions" | "noPromptTemplates" | "noThemes" | "settings" | "packages"
	>;
}

/** 在 Composition 边界创建 Prompt Runtime 默认依赖。 */
export async function createCodingAgentPromptRuntime(
	options: CreateCodingAgentPromptRuntimeOptions,
): Promise<CodingAgentPromptRuntime> {
	const settingsManager = options.settingsManager ?? SettingsRuntime.create(options.cwd, options.agentDir);
	const resourceLoader =
		options.resourceLoader ??
		createCodingAgentSessionResourceRuntime({
			...options.resourceLoaderOptions,
			cwd: options.cwd,
			agentDir: options.agentDir,
			settings: settingsManager,
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
		});
	await resourceLoader.reload();
	return new CodingAgentPromptRuntime({
		cwd: options.cwd,
		resourceLoader,
		settingsManager,
		scenario: options.scenario,
		readAgentMode: options.readAgentMode,
		readMemory: options.readMemory,
		readAgentPlugins: options.readAgentPlugins,
	});
}
