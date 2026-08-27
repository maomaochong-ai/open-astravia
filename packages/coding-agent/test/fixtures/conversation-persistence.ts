import type { RuntimeHostSession } from "@vetta/runtime-core";
import { nodeWorkspaceFactsFileSource } from "@vetta/runtime-node/coding";
import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";
import type {
	CodingAgentConversationPersistenceFactory,
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "../../src/composition/contracts/index.js";
import { createCodingAgentRuntimeComposition as createRuntimeComposition } from "../../src/composition/runtime-composition.js";
import { createIsolatedCodingAgentRuntimeHostSession } from "../../src/composition/runtime-host-session-config.js";
import { createCodingAgentNodeSessionExecutionEnvironment } from "../../src/host/tool-environment/node/node-session-execution-environment.js";
import { createCodingAgentNodeToolEnvironment } from "../../src/host/tool-environment/node/node-tool-environment.js";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "../../src/model-context/workspace-facts.js";

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

export type TestCodingAgentRuntimeComposition = CodingAgentRuntimeComposition & {
	createSession(options: CodingAgentRuntimeSessionOptions): Promise<RuntimeHostSession>;
	resumeSession(options: CodingAgentRuntimeSessionOptions): Promise<RuntimeHostSession>;
};

export function createCodingAgentRuntimeComposition(
	options: TestCompositionOptions,
): Promise<TestCodingAgentRuntimeComposition> {
	return createRuntimeComposition({
		...options,
		workspaceFacts:
			options.workspaceFacts ??
			detectWorkspaceFacts(options.cwd ?? process.cwd(), (cwd) =>
				probeWorkspaceSignals(cwd, nodeWorkspaceFactsFileSource),
			),
		resolveSystemPromptOptions:
			options.resolveSystemPromptOptions ?? (() => ({ customPrompt: "Test system prompt", scenario: "cli" })),
		createConversationPersistence: options.createConversationPersistence ?? createTestConversationPersistence,
		createToolEnvironment: options.createToolEnvironment ?? createCodingAgentNodeToolEnvironment,
		createSessionExecutionEnvironment:
			options.createSessionExecutionEnvironment ?? createCodingAgentNodeSessionExecutionEnvironment,
	}).then((composition) =>
		Object.assign(composition, {
			createSession: (sessionOptions: CodingAgentRuntimeSessionOptions) =>
				createIsolatedCodingAgentRuntimeHostSession(composition, sessionOptions, {
					scenario: composition.scenario,
				}),
			resumeSession: (sessionOptions: CodingAgentRuntimeSessionOptions) =>
				createIsolatedCodingAgentRuntimeHostSession(composition, sessionOptions, {
					resume: true,
					scenario: composition.scenario,
				}),
		}),
	) as Promise<TestCodingAgentRuntimeComposition>;
}
