import {
	createKnowledgeProcessingSessionFactory,
	type KnowledgeProcessingSessionFactory,
} from "@vetta/coding-agent/composition";
import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";

export interface DesktopKnowledgeProcessingSessionFactoryOptions {
	readonly getModelRegistry: () => CodingAgentModelRuntime;
}

/** Knowledge Processing 保留自己的产品组合边界，并复用生产 Runtime 模型服务。 */
export function createDesktopKnowledgeProcessingSessionFactory(
	options: DesktopKnowledgeProcessingSessionFactoryOptions,
): KnowledgeProcessingSessionFactory {
	return createKnowledgeProcessingSessionFactory({
		getModelRegistry: options.getModelRegistry,
	});
}
