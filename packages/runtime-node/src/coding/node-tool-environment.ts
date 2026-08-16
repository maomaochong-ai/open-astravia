import type { CodingToolExecutableResolver, CodingToolRegistration } from "@vetta/runtime-tools";
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
import { createCurrentTimeToolRegistration } from "./tools/current-time/index.js";
import { createEditToolRegistration, type EditPathPolicy } from "./tools/edit/index.js";
import { createFindToolRegistration } from "./tools/find/index.js";
import { createGlobToolRegistration } from "./tools/glob/index.js";
import { createGrepToolRegistration } from "./tools/grep/index.js";
import { createLsToolRegistration } from "./tools/ls/index.js";
import { createReadToolRegistration } from "./tools/read/index.js";
import { createShellToolRegistration } from "./tools/shell/index.js";
import { createTaskOutputToolRegistration } from "./tools/task-output/index.js";
import { createTaskStopToolRegistration } from "./tools/task-stop/index.js";
import { createTreeToolRegistration } from "./tools/tree/index.js";
import { createWriteToolRegistration, type WritePathPolicy } from "./tools/write/index.js";

export interface NodeCodingToolEnvironmentOptions {
	readonly cwd: string;
	readonly foregroundCommand?: ForegroundCommandExecutorOptions;
	readonly backgroundCommandHost?: BackgroundCommandHost;
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
	readonly executableResolver: CodingToolExecutableResolver;
	readonly editPathPolicy: EditPathPolicy;
	readonly writePathPolicy: WritePathPolicy;
}

export interface NodeCodingToolEnvironment {
	readonly registrations: readonly CodingToolRegistration[];
	readonly backgroundService?: BackgroundCommandService;
	dispose(): void;
}

/** 创建 Node 基础工具能力；场景激活、模型顺序和结果策略由上层组合决定。 */
export function createNodeCodingToolEnvironment(options: NodeCodingToolEnvironmentOptions): NodeCodingToolEnvironment {
	const backgroundService =
		options.backgroundService ??
		(options.commandExecutor || !options.backgroundCommandHost
			? undefined
			: createBackgroundCommandService(options.backgroundCommandHost));
	const foregroundExecutor =
		options.commandExecutor ??
		(options.foregroundCommand ? createForegroundCommandToolExecutor(options.foregroundCommand) : undefined);
	if (!foregroundExecutor) {
		throw new Error("Node coding tool environment requires foregroundCommand or commandExecutor");
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
			createCurrentTimeToolRegistration(),
			createReadToolRegistration(options.cwd),
			createEditToolRegistration(options.cwd, { pathPolicy: options.editPathPolicy }),
			createBashToolRegistration(options.cwd, { executor: commandExecutor }),
			createShellToolRegistration(options.cwd, { executor: commandExecutor }),
			...(backgroundService
				? [
						createTaskOutputToolRegistration({ backgroundService }),
						createTaskStopToolRegistration({ backgroundService }),
					]
				: []),
			createLsToolRegistration(options.cwd),
			createGlobToolRegistration(options.cwd),
			createGrepToolRegistration(options.cwd, { executableResolver: options.executableResolver }),
			createFindToolRegistration(options.cwd, { executableResolver: options.executableResolver }),
			createTreeToolRegistration(options.cwd, { executableResolver: options.executableResolver }),
			createWriteToolRegistration(options.cwd, { pathPolicy: options.writePathPolicy }),
		],
		backgroundService,
		dispose: () => backgroundService?.dispose(),
	};
}
