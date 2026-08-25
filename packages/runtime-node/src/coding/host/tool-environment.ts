import type { RuntimeConfigurationSnapshotSource } from "@vetta/runtime-core/configuration";
import stripAnsi from "strip-ansi";
import { createNodeCodingToolEnvironment, type NodeCodingToolEnvironment } from "../node-tool-environment.js";
import type { BackgroundCommandService } from "../shared/background-command-service.js";
import type { CommandToolExecutor } from "../shared/command-tool.js";
import { sanitizeBinaryOutput } from "../shared/text-decoding.js";
import type { EditPathPolicy } from "../tools/edit/index.js";
import type { WritePathPolicy } from "../tools/write/index.js";
import {
	createNodeBackgroundCommandHost,
	createNodeForegroundCommandHost,
	type NodeShellCommand,
} from "./local-command-host.js";
import {
	createManagedCodingToolExecutableResolver,
	type ResolveCodingToolExecutable,
} from "./managed-executables/index.js";

export interface NodeHostCodingToolEnvironmentOptions {
	readonly cwd: string;
	readonly toolsDirectory: string;
	readonly resolveShell: () => NodeShellCommand;
	readonly environment?: () => NodeJS.ProcessEnv;
	readonly protectedDirectories?: readonly string[];
	readonly editPathPolicy: EditPathPolicy;
	readonly writePathPolicy: WritePathPolicy;
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
	readonly resolveExecutable?: ResolveCodingToolExecutable;
	readonly normalizeBackgroundOutput?: (value: string) => string;
	readonly configurationSource?: RuntimeConfigurationSnapshotSource;
}

/**
 * Composes the Node process and filesystem implementations behind one coding-tool environment.
 * Product activation, path policy and directory selection remain explicit caller inputs.
 */
export function createNodeHostCodingToolEnvironment(
	options: NodeHostCodingToolEnvironmentOptions,
): NodeCodingToolEnvironment {
	const foregroundCommand = createNodeForegroundCommandHost({
		resolveShell: options.resolveShell,
		environment: options.environment,
		protectedDirectories: options.protectedDirectories,
	});
	return createNodeCodingToolEnvironment({
		cwd: options.cwd,
		foregroundCommand,
		backgroundCommandHost: createNodeBackgroundCommandHost({
			resolveShell: options.resolveShell,
			normalizeOutput: options.normalizeBackgroundOutput ?? ((value) => sanitizeBinaryOutput(stripAnsi(value))),
		}),
		backgroundService: options.backgroundService,
		commandExecutor: options.commandExecutor,
		executableResolver: createManagedCodingToolExecutableResolver({
			toolsDirectory: options.toolsDirectory,
			resolveExecutable: options.resolveExecutable,
		}),
		editPathPolicy: options.editPathPolicy,
		writePathPolicy: options.writePathPolicy,
		configurationSource: options.configurationSource,
	});
}
