import type { RuntimeConfigurationSnapshotSource } from "@vetta/runtime-core/configuration";
import type { AsyncExecutionGate, CodingToolExecutableResolver, CodingToolRegistration } from "@vetta/runtime-tools";
import { createNodeSpecializedToolRegistrations } from "./host/specialized-tool-registrations.js";
import { createBackgroundCommandToolExecutor } from "./shared/background-command-executor.js";
import type { BackgroundCommandHost } from "./shared/background-command-host.js";
import { createBackgroundCommandService } from "./shared/background-command-lifecycle.js";
import type { BackgroundCommandService } from "./shared/background-command-service.js";
import type { CommandToolExecutor } from "./shared/command-tool.js";
import {
	createForegroundCommandToolExecutor,
	type ForegroundCommandExecutorOptions,
} from "./shared/foreground-command-executor.js";
import { createBashToolRegistration } from "./tools/bash/index.js";
import { createEditToolRegistration, type EditPathPolicy } from "./tools/edit/index.js";
import { createFindToolRegistration } from "./tools/find/index.js";
import { createGlobToolRegistration } from "./tools/glob/index.js";
import { createGrepToolRegistration } from "./tools/grep/index.js";
import { createLsToolRegistration } from "./tools/ls/index.js";
import { createReadToolRegistration, type ReadToolOptions } from "./tools/read/index.js";
import { createShellToolRegistration } from "./tools/shell/index.js";
import { createTreeToolRegistration } from "./tools/tree/index.js";
import { createWriteToolRegistration, type WritePathPolicy } from "./tools/write/index.js";

export interface NodeCodingToolEnvironmentOptions {
	readonly cwd: string;
	readonly platform?: NodeJS.Platform;
	readonly foregroundCommand?: ForegroundCommandExecutorOptions;
	readonly backgroundCommandHost?: BackgroundCommandHost;
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
	readonly executableResolver: CodingToolExecutableResolver;
	readonly editPathPolicy: EditPathPolicy;
	readonly writePathPolicy: WritePathPolicy;
	readonly configurationSource?: RuntimeConfigurationSnapshotSource;
	readonly readOptions?: Pick<ReadToolOptions, "binaryContentHint" | "preserveFullText">;
}

export interface NodeCommandToolEnvironmentOptions {
	readonly cwd: string;
	readonly platform?: NodeJS.Platform;
	readonly foregroundCommand?: ForegroundCommandExecutorOptions;
	readonly backgroundCommandHost?: BackgroundCommandHost;
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
}

export interface NodeCommandToolEnvironment {
	readonly registrations: readonly CodingToolRegistration[];
	readonly backgroundService?: BackgroundCommandService;
	dispose(): void;
}

export interface NodeSpecializedToolRegistrationContext {
	readonly cwd: string;
	readonly ocrExecutionGate: AsyncExecutionGate;
}

export interface NodeCodingToolEnvironment extends NodeCommandToolEnvironment {
	readonly createSpecializedToolRegistrations: (
		context: NodeSpecializedToolRegistrationContext,
	) => readonly CodingToolRegistration[];
}

/** 创建可由 Session 独占的 Node 命令工具与后台任务环境。 */
export function createNodeCommandToolEnvironment(
	options: NodeCommandToolEnvironmentOptions,
): NodeCommandToolEnvironment {
	const backgroundService =
		options.backgroundService ??
		(options.commandExecutor || !options.backgroundCommandHost
			? undefined
			: createBackgroundCommandService(options.backgroundCommandHost));
	const foregroundExecutor =
		options.commandExecutor ??
		(options.foregroundCommand ? createForegroundCommandToolExecutor(options.foregroundCommand) : undefined);
	if (!foregroundExecutor) {
		throw new Error("Node command tool environment requires foregroundCommand or commandExecutor");
	}
	const commandExecutor =
		options.commandExecutor ??
		(backgroundService
			? createBackgroundCommandToolExecutor({
					...options.foregroundCommand,
					foregroundExecutor,
					backgroundService,
				})
			: foregroundExecutor);

	return {
		registrations: [
			(options.platform ?? process.platform) === "win32"
				? createShellToolRegistration(options.cwd, { executor: commandExecutor })
				: createBashToolRegistration(options.cwd, { executor: commandExecutor }),
		],
		backgroundService,
		dispose: () => backgroundService?.dispose(),
	};
}

/** 创建 Node 基础工具能力；场景激活、模型顺序和结果策略由上层组合决定。 */
export function createNodeCodingToolEnvironment(options: NodeCodingToolEnvironmentOptions): NodeCodingToolEnvironment {
	const commandEnvironment = createNodeCommandToolEnvironment(options);

	return {
		registrations: [
			createReadToolRegistration(options.cwd, {
				...options.readOptions,
				configurationSource: options.configurationSource,
			}),
			createEditToolRegistration(options.cwd, { pathPolicy: options.editPathPolicy }),
			...commandEnvironment.registrations,
			createLsToolRegistration(options.cwd),
			createGlobToolRegistration(options.cwd),
			createGrepToolRegistration(options.cwd, { executableResolver: options.executableResolver }),
			createFindToolRegistration(options.cwd, { executableResolver: options.executableResolver }),
			createTreeToolRegistration(options.cwd, { executableResolver: options.executableResolver }),
			createWriteToolRegistration(options.cwd, { pathPolicy: options.writePathPolicy }),
		],
		backgroundService: commandEnvironment.backgroundService,
		createSpecializedToolRegistrations: ({ cwd, ocrExecutionGate }) =>
			createNodeSpecializedToolRegistrations(cwd, { executionGate: ocrExecutionGate }),
		dispose: () => commandEnvironment.dispose(),
	};
}
