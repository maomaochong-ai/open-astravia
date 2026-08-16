import type { RuntimeSessionHostInteractionContext } from "@vetta/runtime-core";
import type { CodingToolRegistration, ForegroundCommandOperations } from "@vetta/runtime-tools";
import type {
	SandboxCommandPlatform,
	SandboxHostServices,
} from "../../adapters/runtime-core/execution-mode/sandbox-host-services.js";
import { buildSandboxToolRegistrations } from "../../adapters/runtime-core/execution-mode/sandbox-tools.js";
import {
	createCodingAgentEditPathPolicy,
	createCodingAgentForegroundCommandHost,
	createCodingAgentWritePathPolicy,
} from "../../adapters/runtime-tools/index.js";

export interface CodingAgentSandboxToolsOptions {
	readonly cwd: string;
	readonly hostInteraction: RuntimeSessionHostInteractionContext;
	readonly platform?: SandboxCommandPlatform;
	readonly windowsSandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly getSessionId?: () => string | undefined;
	readonly hostServices?: SandboxHostServices;
	/** Narrow platform-command port used by contract tests and alternate hosts. */
	readonly commandOperations?: ForegroundCommandOperations;
}

/** 组装 Runtime 原生工具合同与宿主提供的 OS sandbox 命令操作。 */
export function createCodingAgentSandboxToolRegistrations(
	options: CodingAgentSandboxToolsOptions,
): readonly CodingToolRegistration[] {
	const commandHost = createCodingAgentForegroundCommandHost(options.cwd);
	return (
		buildSandboxToolRegistrations({
			...options,
			editPathPolicy: createCodingAgentEditPathPolicy(options.cwd),
			writePathPolicy: createCodingAgentWritePathPolicy(options.cwd),
			commandEnvironment: commandHost.environment,
			protectedDirectories: commandHost.protectedDirectories,
		}) ?? []
	);
}
