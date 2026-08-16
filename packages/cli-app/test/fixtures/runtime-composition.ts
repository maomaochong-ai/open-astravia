import {
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition as createRuntimeComposition,
} from "@vetta/coding-agent/composition";
import { createCodingAgentNodeToolEnvironment } from "@vetta/coding-agent/host-services";
import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";

type TestCompositionOptions = Omit<
	CodingAgentRuntimeCompositionOptions,
	"createConversationPersistence" | "createToolEnvironment"
> &
	Partial<Pick<CodingAgentRuntimeCompositionOptions, "createConversationPersistence" | "createToolEnvironment">>;

/** Tests choose the Node file adapter explicitly instead of relying on hidden host defaults. */
export function createCodingAgentRuntimeComposition(options: TestCompositionOptions) {
	return createRuntimeComposition({
		...options,
		resolveSystemPromptOptions:
			options.resolveSystemPromptOptions ??
			(options.createPromptRuntimeSources || options.promptResourceSource
				? undefined
				: () => ({ customPrompt: "Test system prompt", scenario: "cli" })),
		createConversationPersistence:
			options.createConversationPersistence ??
			(({ conversationDir }) => createFileConversationPersistence(conversationDir)),
		createToolEnvironment: options.createToolEnvironment ?? createCodingAgentNodeToolEnvironment,
	});
}
