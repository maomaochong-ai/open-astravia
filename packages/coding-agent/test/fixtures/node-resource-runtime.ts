import { createNodeCommandExecutor, createNodeResourcePackageHost } from "@vetta/runtime-node/host";
import { getAgentDir, getSceneDir, getUserSkillsDir, getVettaHomePath } from "../../src/config.js";
import { createCodingAgentNodeExtensionFactoryLoader } from "../../src/host/extensions/node-extension-factory-loader.js";
import { createCodingAgentNodeSettingsRuntime } from "../../src/host/node-state-services.js";
import { loadThemeFromContent } from "../../src/modes/interactive/theme/theme.js";
import type { ResourceAccessPort } from "../../src/resources/contracts/resource-access.js";
import type {
	SessionResourceRuntime,
	SessionResourceRuntimeOptions,
} from "../../src/resources/contracts/resource-runtime.js";
import type {
	ResourcePackageCommandPort,
	ResourcePackageDigestPort,
	ResourcePackageEnvironmentPort,
	ResourcePackageFilePort,
	ResourcePackageLocationFacts,
	ResourcePackageRegistryPort,
	ResourcePackageRuntime,
	ResourceSettingsPort,
} from "../../src/resources/contracts/resource-source.js";
import { createResourcePackageRuntime } from "../../src/resources/packages/package-source-runtime.js";
import { createSessionResourceRuntime } from "../../src/resources/runtime/session-resource-runtime.js";

export interface CreateTestResourcePackageRuntimeOptions {
	readonly cwd?: string;
	readonly agentDir?: string;
	readonly settings?: ResourceSettingsPort;
	readonly commands?: ResourcePackageCommandPort;
	readonly digest?: ResourcePackageDigestPort;
	readonly locationFacts?: ResourcePackageLocationFacts;
	readonly resourceAccess?: ResourceAccessPort;
	readonly files?: ResourcePackageFilePort;
	readonly managedSkillsDir?: string;
	readonly registry?: ResourcePackageRegistryPort;
	readonly environment?: ResourcePackageEnvironmentPort;
}

export function createTestResourcePackageRuntime(
	options: CreateTestResourcePackageRuntimeOptions = {},
): ResourcePackageRuntime {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const host = createNodeResourcePackageHost();
	return createResourcePackageRuntime({
		cwd,
		agentDir,
		settings: options.settings ?? createCodingAgentNodeSettingsRuntime(cwd, agentDir),
		commands: options.commands ?? host.commands,
		digest: options.digest ?? host.digest,
		locationFacts: options.locationFacts ?? host.locationFacts,
		resourceAccess: options.resourceAccess ?? host.resourceAccess,
		files: options.files ?? host.files,
		managedSkillsDir: options.managedSkillsDir ?? getUserSkillsDir(),
		registry: options.registry ?? host.registry,
		environment: options.environment ?? host.environment,
	});
}

export type CreateTestSessionResourceRuntimeOptions = Omit<
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
> & {
	readonly cwd?: string;
	readonly agentDir?: string;
	readonly settings?: ResourceSettingsPort;
	readonly packages?: ResourcePackageRuntime;
	readonly resourceAccess?: ResourceAccessPort;
	readonly themeParser?: SessionResourceRuntimeOptions["themeParser"];
	readonly extensionFactoryLoader?: SessionResourceRuntimeOptions["extensionFactoryLoader"];
	readonly extensionCommandExecutor?: SessionResourceRuntimeOptions["extensionCommandExecutor"];
	readonly skillLocations?: SessionResourceRuntimeOptions["skillLocations"];
};

export function createTestSessionResourceRuntime(
	options: CreateTestSessionResourceRuntimeOptions = {},
): SessionResourceRuntime {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const resourceAccess = options.resourceAccess ?? createNodeResourcePackageHost().resourceAccess;
	const settings = options.settings ?? createCodingAgentNodeSettingsRuntime(cwd, agentDir);
	const packages = options.packages ?? createTestResourcePackageRuntime({ cwd, agentDir, settings, resourceAccess });
	return createSessionResourceRuntime({
		...options,
		cwd,
		agentDir,
		settings,
		packages,
		resourceAccess,
		themeParser: options.themeParser ?? loadThemeFromContent,
		extensionFactoryLoader: options.extensionFactoryLoader ?? createCodingAgentNodeExtensionFactoryLoader(),
		extensionCommandExecutor: options.extensionCommandExecutor ?? createNodeCommandExecutor(),
		skillLocations: options.skillLocations ?? {
			sceneDir: getSceneDir(),
			managedSkillsDir: getUserSkillsDir(),
			manifestPath: resourceAccess.paths.join(getVettaHomePath(), "skills-manifest.json"),
		},
	});
}
