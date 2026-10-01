import {
	createKnowledgeProcessingSessionFactory,
	type KnowledgeProcessingSessionFactory,
} from "@astravia/coding-agent/composition";
import { getAgentDir } from "@astravia/coding-agent/config";
import type { CodingAgentModelRuntime } from "@astravia/coding-agent/host-services";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "@astravia/coding-agent/model-context";
import {
	createDesktopCodingAgentSessionExecutionEnvironment,
	createDesktopCodingAgentToolEnvironment,
	createDesktopResultArtifactRuntime,
} from "@astravia/runtime-desktop";
import { nodeModelInputImageProcessor, nodeWorkspaceFactsFileSource } from "@astravia/runtime-node/coding";
import { createFileConversationPersistence } from "@astravia/runtime-node/conversation";
import { createNodeKnowledgeRuntime } from "@astravia/runtime-node/host";
import { createDesktopPromptRuntimeSources } from "../agent-runtime/resource-runtime.js";
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
		createPromptRuntimeSources: createDesktopPromptRuntimeSources,
		codingToolResultPolicy: resultArtifacts.codingToolResultPolicy,
		modelInputImageProcessor: nodeModelInputImageProcessor,
		knowledgeRuntime: createNodeKnowledgeRuntime(getKnowledgeRoot()),
		resolveWorkspaceFacts: (cwd) =>
			detectWorkspaceFacts(cwd, (root) => probeWorkspaceSignals(root, nodeWorkspaceFactsFileSource)),
	});
}
