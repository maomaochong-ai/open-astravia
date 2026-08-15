import {
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition as createProductionComposition,
} from "@vetta/coding-agent/composition";
import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";

type TestCompositionOptions = Omit<CodingAgentRuntimeCompositionOptions, "createConversationPersistence"> &
	Partial<Pick<CodingAgentRuntimeCompositionOptions, "createConversationPersistence">>;

/** Tests choose the Node file adapter explicitly instead of relying on product-layer defaults. */
export function createCodingAgentRuntimeComposition(options: TestCompositionOptions) {
	return createProductionComposition({
		...options,
		createConversationPersistence:
			options.createConversationPersistence ??
			(({ conversationDir }) => createFileConversationPersistence(conversationDir)),
	});
}
