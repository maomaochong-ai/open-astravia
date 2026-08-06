import {
	createKnowledgeProcessingSessionFactory as createGreenfieldKnowledgeProcessingSessionFactory,
	type KnowledgeProcessingSessionFactory,
} from "@vetta/coding-agent/composition";
import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import type { DesktopAgentRuntimeBackend } from "../greenfield-runtime/desktop-runtime-selector.js";

export interface DesktopKnowledgeProcessingSessionFactoryOptions {
	readonly backend: Extract<DesktopAgentRuntimeBackend, "greenfield">;
	readonly getModelRegistry: () => CodingAgentModelRuntime;
}

/**
 * Knowledge Processing 保留自己的产品组合边界，并跟随已经完成的 Desktop Greenfield 切换。
 * 上游仍传入进程决策的有效 Backend，以防后续重新引入未审计的执行分支。
 */
export function createDesktopKnowledgeProcessingSessionFactory(
	options: DesktopKnowledgeProcessingSessionFactoryOptions,
): KnowledgeProcessingSessionFactory {
	return createGreenfieldKnowledgeProcessingSessionFactory({
		getModelRegistry: options.getModelRegistry,
	});
}
