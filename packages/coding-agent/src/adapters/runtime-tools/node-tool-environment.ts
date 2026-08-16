import {
	type BackgroundCommandService,
	type CommandToolExecutor,
	createManagedCodingToolExecutableResolver,
	createNodeCodingToolEnvironment,
	type ResolveCodingToolExecutable,
} from "@vetta/runtime-node/coding";
import type {
	CodingAgentToolEnvironment,
	CodingAgentToolEnvironmentContext,
} from "../../composition/contracts/index.js";
import { getBinDir } from "../../config.js";
import { createCodingAgentBackgroundCommandHost } from "./background-command-host.js";
import { createCodingAgentEditPathPolicy } from "./edit-path-policy.js";
import { createCodingAgentForegroundCommandHost } from "./foreground-command-operations.js";
import { createCodingAgentWritePathPolicy } from "./write-path-policy.js";

export interface CodingAgentNodeToolEnvironmentOptions {
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
	readonly ensureTool?: ResolveCodingToolExecutable;
}

/** 迁移期 Node 工具环境；最终平台根必须显式选择该实现。 */
export function createCodingAgentNodeToolEnvironment(
	context: CodingAgentToolEnvironmentContext,
	options: CodingAgentNodeToolEnvironmentOptions = {},
): CodingAgentToolEnvironment {
	const commandHost = createCodingAgentForegroundCommandHost(context.cwd);
	return createNodeCodingToolEnvironment({
		cwd: context.cwd,
		foregroundCommand: commandHost,
		backgroundCommandHost: createCodingAgentBackgroundCommandHost(),
		backgroundService: options.backgroundService,
		commandExecutor: options.commandExecutor,
		executableResolver: createManagedCodingToolExecutableResolver({
			toolsDirectory: getBinDir(),
			resolveExecutable: options.ensureTool,
		}),
		editPathPolicy: createCodingAgentEditPathPolicy(context.cwd),
		writePathPolicy: createCodingAgentWritePathPolicy(context.cwd),
	});
}
