import type { RuntimeSessionHostInteractionContext } from "@vetta/runtime-core";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import type { CodingAgentSandboxEnvironment } from "../../composition/contracts/session-execution-environment.js";
import { createSandboxToolRegistrations } from "./sandbox/sandbox-tool-utils.js";

export interface CodingAgentSandboxToolsOptions {
	readonly cwd: string;
	readonly hostInteraction: RuntimeSessionHostInteractionContext;
	readonly windowsSandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly getSessionId?: () => string | undefined;
	readonly environment: CodingAgentSandboxEnvironment;
}

/** 组装 Runtime 原生工具合同与宿主提供的 OS sandbox 命令操作。 */
export function createCodingAgentSandboxToolRegistrations(
	options: CodingAgentSandboxToolsOptions,
): readonly CodingToolRegistration[] {
	const toolSet = options.environment.createToolSet({
		windowsSandboxHostPath: options.windowsSandboxHostPath,
		linuxBubblewrapPath: options.linuxBubblewrapPath,
		macosSandboxExecPath: options.macosSandboxExecPath,
	});
	if (!toolSet) return [];
	return createSandboxToolRegistrations({
		cwd: options.cwd,
		hostInteraction: options.hostInteraction,
		getSessionId: options.getSessionId,
		toolSet,
	});
}
