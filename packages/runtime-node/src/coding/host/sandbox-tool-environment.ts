import type { RuntimeConfigurationSnapshotSource } from "@vetta/runtime-core/configuration";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import { createNodeSandboxHost, type NodeSandboxHost, type NodeSandboxHostOptions } from "../../sandbox/index.js";
import { createForegroundCommandToolExecutor } from "../shared/foreground-command-executor.js";
import { createBashToolRegistration } from "../tools/bash/index.js";
import { createEditToolRegistration, type EditPathPolicy } from "../tools/edit/index.js";
import { createReadToolRegistration } from "../tools/read/index.js";
import { createShellToolRegistration } from "../tools/shell/index.js";
import { createWriteToolRegistration, type WritePathPolicy } from "../tools/write/index.js";

export interface NodeSandboxCodingToolEnvironmentOptions extends NodeSandboxHostOptions {
	readonly cwd: string;
	readonly environment?: () => Readonly<Record<string, string | undefined>>;
	readonly protectedDirectories?: readonly string[];
	readonly editPathPolicy: EditPathPolicy;
	readonly writePathPolicy: WritePathPolicy;
	readonly configurationSource?: RuntimeConfigurationSnapshotSource;
}

export interface NodeSandboxCodingToolEnvironment {
	readonly read: CodingToolRegistration;
	readonly write: CodingToolRegistration;
	readonly edit: CodingToolRegistration;
	readonly command: CodingToolRegistration;
	readonly hostServices: NodeSandboxHost;
}

/** Creates the concrete Node tools that may be exposed by a Session sandbox policy. */
export function createNodeSandboxCodingToolEnvironment(
	options: NodeSandboxCodingToolEnvironmentOptions,
): NodeSandboxCodingToolEnvironment | undefined {
	const hostServices = createNodeSandboxHost(options);
	if (!hostServices) return undefined;
	const executor = createForegroundCommandToolExecutor({
		operations: hostServices.commandOperations,
		environment: options.environment,
		protectedDirectories: options.protectedDirectories,
	});
	const command =
		hostServices.platform === "win32"
			? createShellToolRegistration(options.cwd, { executor, platform: hostServices.platform })
			: createBashToolRegistration(options.cwd, { executor, platform: hostServices.platform });

	return {
		read: createReadToolRegistration(options.cwd, { configurationSource: options.configurationSource }),
		write: createWriteToolRegistration(options.cwd, { pathPolicy: options.writePathPolicy }),
		edit: createEditToolRegistration(options.cwd, { pathPolicy: options.editPathPolicy }),
		command,
		hostServices,
	};
}
