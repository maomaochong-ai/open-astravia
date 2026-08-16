import { createNodeCommandExecutor, createNodeResourcePackageHost } from "@vetta/runtime-node/host";
import { getSceneDir, getUserSkillsDir, getVettaHomePath } from "../../config.js";
import { loadThemeFromContent } from "../../modes/interactive/theme/theme.js";
import type {
	SessionResourceRuntime,
	SessionResourceRuntimeOptions,
} from "../../resources/contracts/resource-runtime.js";
import type { ResourceSettingsPort } from "../../resources/contracts/resource-source.js";
import { createResourcePackageRuntime } from "../../resources/packages/package-source-runtime.js";
import { createSessionResourceRuntime } from "../../resources/runtime/session-resource-runtime.js";
import { createCodingAgentNodeExtensionFactoryLoader } from "../extensions/node-extension-factory-loader.js";

export interface CreateCodingAgentSdkSessionResourceRuntimeOptions
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
	> {
	readonly cwd: string;
	readonly agentDir: string;
	readonly settings: ResourceSettingsPort;
}

export function createCodingAgentSdkSessionResourceRuntime(
	options: CreateCodingAgentSdkSessionResourceRuntimeOptions,
): SessionResourceRuntime {
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
