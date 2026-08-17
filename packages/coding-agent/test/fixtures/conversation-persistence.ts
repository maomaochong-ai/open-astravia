import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";
import type {
	CodingAgentConversationPersistenceFactory,
	CodingAgentRuntimeCompositionOptions,
} from "../../src/composition/contracts/index.js";
import { createCodingAgentRuntimeComposition as createRuntimeComposition } from "../../src/composition/runtime-composition.js";
import { createCodingAgentNodeSessionExecutionEnvironment } from "../../src/host/tool-environment/node/node-session-execution-environment.js";
import { createCodingAgentNodeToolEnvironment } from "../../src/host/tool-environment/node/node-tool-environment.js";

/** Node test adapter; host composition roots must choose their own platform implementation. */
export const createTestConversationPersistence: CodingAgentConversationPersistenceFactory = ({ conversationDir }) =>
	createFileConversationPersistence(conversationDir);

type TestCompositionOptions = Omit<
	CodingAgentRuntimeCompositionOptions,
	"createConversationPersistence" | "createSessionExecutionEnvironment" | "createToolEnvironment"
> &
	Partial<
		Pick<
			CodingAgentRuntimeCompositionOptions,
			"createConversationPersistence" | "createSessionExecutionEnvironment" | "createToolEnvironment"
		>
	>;

export function createCodingAgentRuntimeComposition(options: TestCompositionOptions) {
	return createRuntimeComposition({
		...options,
		resolveSystemPromptOptions:
			options.resolveSystemPromptOptions ?? (() => ({ customPrompt: "Test system prompt", scenario: "cli" })),
		createConversationPersistence: options.createConversationPersistence ?? createTestConversationPersistence,
		createToolEnvironment: options.createToolEnvironment ?? createCodingAgentNodeToolEnvironment,
		createSessionExecutionEnvironment:
			options.createSessionExecutionEnvironment ?? createCodingAgentNodeSessionExecutionEnvironment,
	});
}
