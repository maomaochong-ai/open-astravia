import {
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	type CodingAgentRuntimeSessionOptions,
	type CodingAgentSessionExecutionEnvironmentFactory,
	createIsolatedCodingAgentRuntimeHostSession,
	createCodingAgentRuntimeComposition as createRuntimeComposition,
} from "@vetta/coding-agent/composition";
import { getAgentDir } from "@vetta/coding-agent/config";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "@vetta/coding-agent/model-context";
import { SettingsRuntime } from "@vetta/coding-agent/settings";
import type { RuntimeHostSession } from "@vetta/runtime-core";
import { nodeWorkspaceFactsFileSource } from "@vetta/runtime-node/coding";
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

export const createUnsandboxedTestSessionExecutionEnvironment: CodingAgentSessionExecutionEnvironmentFactory = async (
	context,
) => {
	const environment = await createTestSessionExecutionEnvironment(context);
	return {
		...environment,
		sandbox: { createToolSet: () => undefined },
	};
};

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

/** Tests choose the Node file adapter explicitly instead of relying on hidden host defaults. */
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
