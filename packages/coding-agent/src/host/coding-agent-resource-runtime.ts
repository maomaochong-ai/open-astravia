import { getAgentDir } from "../config.js";
import type { SessionResourceRuntime, SessionResourceRuntimeOptions } from "../resources/contracts/resource-runtime.js";
import type {
	ResourcePackageCommandPort,
	ResourcePackageRegistryPort,
	ResourcePackageRuntime,
	ResourceSettingsPort,
} from "../resources/contracts/resource-source.js";
import {
	createResourcePackageRuntime,
	type ResourcePackageRuntimeOptions,
} from "../resources/packages/package-source-runtime.js";
import { createSessionResourceRuntime } from "../resources/runtime/session-resource-runtime.js";
import { SettingsRuntime } from "../settings/index.js";

export interface CodingAgentResourcePackageRuntimeOptions {
	cwd?: string;
	agentDir?: string;
	settings?: ResourceSettingsPort;
	commands?: ResourcePackageCommandPort;
	registry?: ResourcePackageRegistryPort;
}

export function createCodingAgentResourcePackageRuntime(
	options: CodingAgentResourcePackageRuntimeOptions = {},
): ResourcePackageRuntime {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const runtimeOptions: ResourcePackageRuntimeOptions = {
		cwd,
		agentDir,
		settings: options.settings ?? SettingsRuntime.create(cwd, agentDir),
	};
	if (options.commands) runtimeOptions.commands = options.commands;
	if (options.registry) runtimeOptions.registry = options.registry;
	return createResourcePackageRuntime(runtimeOptions);
}

export type CodingAgentSessionResourceRuntimeOptions = Omit<
	SessionResourceRuntimeOptions,
	"cwd" | "agentDir" | "packages"
> & {
	cwd?: string;
	agentDir?: string;
	settings?: ResourceSettingsPort;
	packages?: ResourcePackageRuntime;
};

export function createCodingAgentSessionResourceRuntime(
	options: CodingAgentSessionResourceRuntimeOptions = {},
): SessionResourceRuntime {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const settings = options.settings ?? SettingsRuntime.create(cwd, agentDir);
	const packages = options.packages ?? createCodingAgentResourcePackageRuntime({ cwd, agentDir, settings });
	return createSessionResourceRuntime({ ...options, cwd, agentDir, packages, settings });
}
