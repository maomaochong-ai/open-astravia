import {
	createNodeHostSessionCommandEnvironment,
	createNodeSandboxCodingToolEnvironment,
} from "@vetta/runtime-node/coding";
import type {
	CodingAgentSessionExecutionEnvironment,
	CodingAgentSessionExecutionEnvironmentContext,
} from "../../../composition/contracts/session-execution-environment.js";
import { createCodingAgentSessionCommandEnvironment } from "../../../composition/session-command-environment.js";
import { createCodingAgentEditPathPolicy } from "../../../tool-policy/path/edit-path-policy.js";
import { createCodingAgentWritePathPolicy } from "../../../tool-policy/path/write-path-policy.js";
import { getDefaultShellCommandPrefix, getShellConfig, getShellEnv } from "../../command-execution/shell-runtime.js";
import { createCodingAgentNodePathPolicy } from "./node-path-policy.js";

/** @deprecated Node SDK compatibility composition; application hosts must select their own platform environment. */
export function createCodingAgentNodeSessionExecutionEnvironment(
	context: CodingAgentSessionExecutionEnvironmentContext,
): CodingAgentSessionExecutionEnvironment {
	const pathPolicy = createCodingAgentNodePathPolicy(context.cwd);
	const resolveShell = () => {
		const { shell, args } = getShellConfig();
		return { executable: shell, args, commandPrefix: getDefaultShellCommandPrefix(shell) };
	};
	const command = createNodeHostSessionCommandEnvironment({
		cwd: context.cwd,
		resolveShell,
		environment: getShellEnv,
		sessionEnvironment: createCodingAgentSessionCommandEnvironment(context.sessionId, context.env),
		protectedDirectories: pathPolicy.protectedCommandDirectories,
	});
	return {
		registrations: command.registrations,
		backgroundService: command.backgroundService,
		sandbox: {
			createToolSet: (options) =>
				createNodeSandboxCodingToolEnvironment({
					...options,
					cwd: context.cwd,
					resolveShell,
					environment: command.commandEnvironment,
					protectedDirectories: pathPolicy.protectedCommandDirectories,
					editPathPolicy: createCodingAgentEditPathPolicy(pathPolicy.boundaries),
					writePathPolicy: createCodingAgentWritePathPolicy(pathPolicy.boundaries),
					configurationSource: context.configurationSource,
				}),
		},
		dispose: () => command.dispose(),
	};
}
