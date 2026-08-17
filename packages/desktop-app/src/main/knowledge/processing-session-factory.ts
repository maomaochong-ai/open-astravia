import {
	createKnowledgeProcessingSessionFactory,
	type KnowledgeProcessingSessionFactory,
} from "@vetta/coding-agent/composition";
import { getAgentDir } from "@vetta/coding-agent/config";
import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import {
	createDesktopCodingAgentSessionExecutionEnvironment,
	createDesktopCodingAgentToolEnvironment,
	createDesktopResultArtifactRuntime,
} from "@vetta/runtime-desktop";
import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";
import { createNodeKnowledgeRuntime } from "@vetta/runtime-node/host";
import { getKnowledgeRoot } from "./knowledge-layout.js";

export interface DesktopKnowledgeProcessingSessionFactoryOptions {
	readonly getModelRegistry: () => CodingAgentModelRuntime;
}

/** Knowledge Processing 保留独立的场景装配边界，并复用宿主提供的模型与工具服务。 */
export function createDesktopKnowledgeProcessingSessionFactory(
	options: DesktopKnowledgeProcessingSessionFactoryOptions,
): KnowledgeProcessingSessionFactory {
	const resultArtifacts = createDesktopResultArtifactRuntime(getAgentDir());
	return createKnowledgeProcessingSessionFactory({
		getModelRegistry: options.getModelRegistry,
		createConversationPersistence: ({ conversationDir }) => createFileConversationPersistence(conversationDir),
		createToolEnvironment: createDesktopCodingAgentToolEnvironment,
		createSessionExecutionEnvironment: createDesktopCodingAgentSessionExecutionEnvironment,
		codingToolResultPolicy: resultArtifacts.codingToolResultPolicy,
		knowledgeRuntime: createNodeKnowledgeRuntime(getKnowledgeRoot()),
	});
}
