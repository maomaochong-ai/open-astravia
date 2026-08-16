import type { ConversationScenario } from "@vetta/runtime-core";
import type { BackgroundCommandService, CodingToolRegistration } from "@vetta/runtime-tools";

export interface CodingAgentToolEnvironmentContext {
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
}

/** 平台提供的基础工具能力；工具选择、排序和结果策略仍由 Coding Agent 决定。 */
export interface CodingAgentToolEnvironment {
	readonly registrations: readonly CodingToolRegistration[];
	readonly backgroundService?: BackgroundCommandService;
	dispose(): void;
}

export type CodingAgentToolEnvironmentFactory = (
	context: CodingAgentToolEnvironmentContext,
) => CodingAgentToolEnvironment | Promise<CodingAgentToolEnvironment>;
