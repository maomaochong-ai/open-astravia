import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import type { CodingAgentRuntimeComposition, CodingAgentRuntimeCompositionOptions } from "../contracts/index.js";
import type {
	CodingAgentSubagentChildComposition,
	CodingAgentSubagentChildCompositionRequest,
} from "./session-assembly.js";

export type CodingAgentChildRuntimeCompositionFactory = (
	options: CodingAgentRuntimeCompositionOptions,
	inheritedMcpView: McpRuntimeToolView,
) => Promise<CodingAgentRuntimeComposition>;

export interface CodingAgentChildCompositionFactoryOptions {
	readonly parentOptions: CodingAgentRuntimeCompositionOptions;
	readonly createComposition: CodingAgentChildRuntimeCompositionFactory;
}

/** 将父 Composition 投影为隔离的单层 Child Composition。 */
export function createCodingAgentChildCompositionFactory(
	options: CodingAgentChildCompositionFactoryOptions,
): (request: CodingAgentSubagentChildCompositionRequest) => Promise<CodingAgentSubagentChildComposition> {
	return async (request) => {
		const childComposition = await options.createComposition(
			createChildCompositionOptions(options.parentOptions, request),
			request.inheritedMcpView,
		);
		return {
			createSession: (childOptions) => childComposition.backend.create(childOptions),
			resumeSession: (childOptions) => childComposition.backend.resume(childOptions),
			appendSessionContext: (sessionId, records) => childComposition.appendSessionContext(sessionId, records),
			deliverSessionContext: (sessionId, records) => childComposition.deliverSessionContext(sessionId, records),
			dispose: () => childComposition.dispose(),
		};
	};
}

function createChildCompositionOptions(
	parent: CodingAgentRuntimeCompositionOptions,
	request: CodingAgentSubagentChildCompositionRequest,
): CodingAgentRuntimeCompositionOptions {
	const {
		mcpSource: _mcpSource,
		createPluginMcpRuntime: _createPluginMcpRuntime,
		extensionTools: _extensionTools,
		...inheritedOptions
	} = parent;
	return {
		...inheritedOptions,
		conversationDir: request.conversationDir,
		initialModel: request.initialModel,
		initialThinkingLevel: request.initialThinkingLevel,
		cwd: request.cwd,
		activation: request.activation,
		enableSubagents: false,
	};
}
