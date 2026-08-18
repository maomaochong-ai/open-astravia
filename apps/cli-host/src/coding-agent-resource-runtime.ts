import { join } from "node:path";
import type {
	CodingAgentPromptRuntimeSourceContext,
	CodingAgentPromptRuntimeSources,
} from "@vetta/coding-agent/composition";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	getSceneDir,
	getUserSkillsDir,
	getVettaHomePath,
} from "@vetta/coding-agent/config";
import {
	configureThemeRuntime,
	detectColorMode,
	detectTerminalBackground,
	loadThemeFromContent,
} from "@vetta/coding-agent/extensions";
import { createCodingAgentNodeExtensionFactoryLoader } from "@vetta/coding-agent/host-services";
import {
	createResourcePackageRuntime,
	createSessionResourceRuntime,
	type ResourcePackageRuntime,
	type ResourceSettingsPort,
	type SessionResourceRuntime,
	type SessionResourceRuntimeOptions,
} from "@vetta/coding-agent/resources";
import { createSettingsRuntimeFromStorage, type SettingsRuntime } from "@vetta/coding-agent/settings";
import {
	createNodeCommandExecutor,
	createNodeResourcePackageHost,
	NodeScopedTextStorage,
	nodeTextFileWatchPort,
} from "@vetta/runtime-node/host";

export interface CliResourceRuntimeScope {
	readonly cwd: string;
	readonly agentDir: string;
	readonly settings: ResourceSettingsPort;
}

export interface CreateCliSessionResourceRuntimeOptions
	extends Omit<
			SessionResourceRuntimeOptions,
			| "cwd"
			| "agentDir"
			| "settings"
			| "packages"
			| "resourceAccess"
			| "themeParser"
			| "extensionFactoryLoader"
			| "extensionCommandExecutor"
			| "skillLocations"
		>,
		CliResourceRuntimeScope {}

export function createCliSettingsRuntime(cwd: string, agentDir: string): SettingsRuntime {
	return createSettingsRuntimeFromStorage(
		new NodeScopedTextStorage({
			global: join(agentDir, "settings.json"),
			project: join(cwd, CONFIG_DIR_NAME, "settings.json"),
		}),
		{
			clearOnShrink: process.env.PI_CLEAR_ON_SHRINK === "1",
			showHardwareCursor: process.env.PI_HARDWARE_CURSOR === "1",
		},
	);
}

export function createCliResourcePackageRuntime(scope: CliResourceRuntimeScope): ResourcePackageRuntime {
	const host = createNodeResourcePackageHost();
	return createResourcePackageRuntime({
		cwd: scope.cwd,
		agentDir: scope.agentDir,
		settings: scope.settings,
		...host,
		managedSkillsDir: getUserSkillsDir(),
	});
}

export function createCliSessionResourceRuntime(
	options: CreateCliSessionResourceRuntimeOptions,
): SessionResourceRuntime {
	configureThemeRuntime({
		colorMode: detectColorMode(process.env),
		defaultThemeName: detectTerminalBackground(process.env),
		watcher: nodeTextFileWatchPort,
	});
	const host = createNodeResourcePackageHost();
	const packages = createResourcePackageRuntime({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settings: options.settings,
		...host,
		managedSkillsDir: getUserSkillsDir(),
	});
	return createSessionResourceRuntime({
		...options,
		packages,
		resourceAccess: host.resourceAccess,
		themeParser: loadThemeFromContent,
		extensionFactoryLoader: createCodingAgentNodeExtensionFactoryLoader(),
		extensionCommandExecutor: createNodeCommandExecutor(),
		skillLocations: {
			sceneDir: getSceneDir(),
			managedSkillsDir: getUserSkillsDir(),
			manifestPath: host.resourceAccess.paths.join(getVettaHomePath(), "skills-manifest.json"),
		},
	});
}

export async function createCliPromptRuntimeSources(
	context: CodingAgentPromptRuntimeSourceContext,
): Promise<CodingAgentPromptRuntimeSources> {
	const agentDir = context.agentDir ?? getAgentDir();
	const settingsSource = createCliSettingsRuntime(context.cwd, agentDir);
	const resourceSource = createCliSessionResourceRuntime({
		cwd: context.cwd,
		agentDir,
		settings: settingsSource,
		includeAgentSkills: context.sessionOptions.includeAgentSkills,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await resourceSource.reload();
	return { resourceSource, settingsSource };
}
