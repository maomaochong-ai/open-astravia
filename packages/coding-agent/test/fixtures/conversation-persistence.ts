import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";
import type {
	CodingAgentConversationPersistenceFactory,
	CodingAgentRuntimeCompositionOptions,
} from "../../src/composition/contracts/index.js";
import { createCodingAgentRuntimeComposition as createProductionComposition } from "../../src/composition/runtime-composition.js";

/** Node test adapter; production composition roots must choose their own platform implementation. */
export const createTestConversationPersistence: CodingAgentConversationPersistenceFactory = ({ conversationDir }) =>
	createFileConversationPersistence(conversationDir);

type TestCompositionOptions = Omit<CodingAgentRuntimeCompositionOptions, "createConversationPersistence"> &
	Partial<Pick<CodingAgentRuntimeCompositionOptions, "createConversationPersistence">>;

export function createCodingAgentRuntimeComposition(options: TestCompositionOptions) {
	return createProductionComposition({
		...options,
		createConversationPersistence: options.createConversationPersistence ?? createTestConversationPersistence,
	});
}
