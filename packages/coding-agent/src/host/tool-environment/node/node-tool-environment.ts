import {
	type BackgroundCommandService,
	type CommandToolExecutor,
	createNodeHostCodingToolEnvironment,
	type ResolveCodingToolExecutable,
} from "@vetta/runtime-node/coding";
import type {
	CodingAgentToolEnvironment,
	CodingAgentToolEnvironmentContext,
} from "../../../composition/contracts/index.js";
import { createCodingAgentEditPathPolicy } from "../../../tool-policy/path/edit-path-policy.js";
import { createCodingAgentWritePathPolicy } from "../../../tool-policy/path/write-path-policy.js";
import { CODING_AGENT_READ_TOOL_OPTIONS } from "../../../tool-policy/read-tool-policy.js";
import { getDefaultShellCommandPrefix, getShellConfig, getShellEnv } from "../../command-execution/shell-runtime.js";
import { getBinDir } from "../../node-config.js";
import { createCodingAgentNodePathPolicy } from "./node-path-policy.js";

export interface CodingAgentNodeToolEnvironmentOptions {
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
	readonly ensureTool?: ResolveCodingToolExecutable;
}

/** @deprecated Node SDK 兼容装配；应用宿主必须在最终 Composition Root 选择平台实现。 */
export function createCodingAgentNodeToolEnvironment(
	context: CodingAgentToolEnvironmentContext,
	options: CodingAgentNodeToolEnvironmentOptions = {},
): CodingAgentToolEnvironment {
	const pathPolicy = createCodingAgentNodePathPolicy(context.cwd);
	return createNodeHostCodingToolEnvironment({
		cwd: context.cwd,
		toolsDirectory: getBinDir(),
		resolveShell: () => {
			const { shell, args } = getShellConfig();
			return { executable: shell, args, commandPrefix: getDefaultShellCommandPrefix(shell) };
		},
		environment: getShellEnv,
		protectedDirectories: pathPolicy.protectedCommandDirectories,
		backgroundService: options.backgroundService,
		commandExecutor: options.commandExecutor,
		resolveExecutable: options.ensureTool,
		editPathPolicy: createCodingAgentEditPathPolicy(pathPolicy.boundaries),
		writePathPolicy: createCodingAgentWritePathPolicy(pathPolicy.boundaries),
		configurationSource: context.configurationSource,
		readOptions: CODING_AGENT_READ_TOOL_OPTIONS,
	});
}
