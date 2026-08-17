import {
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition as createRuntimeComposition,
} from "@vetta/coding-agent/composition";
import { getAgentDir } from "@vetta/coding-agent/config";
import { SettingsRuntime } from "@vetta/coding-agent/settings";
import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";
import {
	createCliCodingAgentSessionExecutionEnvironmentFactory,
	createCliCodingAgentToolEnvironmentFactory,
} from "../../src/rpc/runtime-host/cli-tool-environment.js";

const createTestToolEnvironment = createCliCodingAgentToolEnvironmentFactory({
	agentDir: getAgentDir(),
	settings: SettingsRuntime.inMemory(),
});
const createTestSessionExecutionEnvironment = createCliCodingAgentSessionExecutionEnvironmentFactory({
	agentDir: getAgentDir(),
	settings: SettingsRuntime.inMemory(),
});

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
		createToolEnvironment: options.createToolEnvironment ?? createTestToolEnvironment,
		createSessionExecutionEnvironment:
			options.createSessionExecutionEnvironment ?? createTestSessionExecutionEnvironment,
	});
}
