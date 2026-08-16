import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";
import { createCodingAgentNodeToolEnvironment } from "../../src/adapters/runtime-tools/node-tool-environment.js";
import type {
	CodingAgentConversationPersistenceFactory,
	CodingAgentRuntimeCompositionOptions,
} from "../../src/composition/contracts/index.js";
import { createCodingAgentRuntimeComposition as createRuntimeComposition } from "../../src/composition/runtime-composition.js";

/** Node test adapter; host composition roots must choose their own platform implementation. */
export const createTestConversationPersistence: CodingAgentConversationPersistenceFactory = ({ conversationDir }) =>
	createFileConversationPersistence(conversationDir);

type TestCompositionOptions = Omit<
	CodingAgentRuntimeCompositionOptions,
	"createConversationPersistence" | "createToolEnvironment"
> &
	Partial<Pick<CodingAgentRuntimeCompositionOptions, "createConversationPersistence" | "createToolEnvironment">>;

export function createCodingAgentRuntimeComposition(options: TestCompositionOptions) {
	return createRuntimeComposition({
		...options,
		resolveSystemPromptOptions:
			options.resolveSystemPromptOptions ?? (() => ({ customPrompt: "Test system prompt", scenario: "cli" })),
		createConversationPersistence: options.createConversationPersistence ?? createTestConversationPersistence,
		createToolEnvironment: options.createToolEnvironment ?? createCodingAgentNodeToolEnvironment,
	});
}
