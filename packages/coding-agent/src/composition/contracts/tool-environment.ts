import type { RuntimeConfigurationSnapshotSource } from "@vetta/runtime-core/configuration";
import type { AsyncExecutionGate, BackgroundCommandService, CodingToolRegistration } from "@vetta/runtime-tools";
import type { ConversationScenario } from "../../profiles/index.js";

export interface CodingAgentToolEnvironmentContext {
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
	readonly configurationSource?: RuntimeConfigurationSnapshotSource;
}

/** 平台提供的文件、命令等基础 Tool；产品 Tool、选择、排序和结果策略由 Coding Agent 决定。 */
export interface CodingAgentToolEnvironment {
	readonly registrations: readonly CodingToolRegistration[];
	readonly backgroundService?: BackgroundCommandService;
	readonly createSpecializedToolRegistrations?: (
		context: CodingAgentSpecializedToolRegistrationContext,
	) => readonly CodingToolRegistration[] | Promise<readonly CodingToolRegistration[]>;
	dispose(): void;
}

export interface CodingAgentSpecializedToolRegistrationContext extends CodingAgentToolEnvironmentContext {
	readonly ocrExecutionGate: AsyncExecutionGate;
}

export type CodingAgentToolEnvironmentFactory = (
	context: CodingAgentToolEnvironmentContext,
) => CodingAgentToolEnvironment | Promise<CodingAgentToolEnvironment>;
