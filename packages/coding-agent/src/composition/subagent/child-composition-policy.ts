import { RetryableCleanup, RuntimeHost } from "@vetta/runtime-core";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import type { CodingAgentPromptResourceSource } from "../../runtime-contracts/index.js";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentSubagentSkillPolicy,
} from "../contracts/index.js";
import { createCodingAgentRuntimeHostSessionConfig } from "../runtime-host-session-config.js";
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
		const runtimeHost = new RuntimeHost({
			sessionBackend: childComposition.runtimeHostBackend,
			observationPublisher: childComposition.observations.publisher(),
			// 子 Composition 迁移前继承父级直连工具模式；沙箱策略仍由显式 Session 配置覆盖。
			getDefaultExecutionMode: () => "full-access",
		});
		const createSession = async (
			childOptions: Parameters<CodingAgentSubagentChildComposition["createSession"]>[0],
			resume: boolean,
		) => {
			const created = await runtimeHost.createSession(
				createCodingAgentRuntimeHostSessionConfig(
					childComposition.agentRuntime,
					{
						...childOptions,
						scenario: childComposition.scenario,
					},
					{
						...(resume ? { sessionPath: childOptions.sessionId } : {}),
					},
				),
			);
			return runtimeHost.getSessionView(created.sessionId);
		};
		return {
			createSession: (childOptions) => createSession(childOptions, false),
			resumeSession: (childOptions) => createSession(childOptions, true),
			appendSessionContext: (sessionId, records) => childComposition.appendSessionContext(sessionId, records),
			deliverSessionContext: (sessionId, records) => childComposition.deliverSessionContext(sessionId, records),
			dispose: () => disposeChildComposition(runtimeHost, childComposition),
		};
	};
}

async function disposeChildComposition(
	runtimeHost: RuntimeHost,
	composition: CodingAgentRuntimeComposition,
): Promise<void> {
	const cleanup = new RetryableCleanup();
	cleanup.add({ id: "runtime-host", phase: 0, cleanup: () => runtimeHost.close() });
	cleanup.add({ id: "composition", phase: 1, cleanup: () => composition.dispose() });
	await cleanup.run("Coding Agent child composition disposal failed");
}

function createChildCompositionOptions(
	parent: CodingAgentRuntimeCompositionOptions,
	request: CodingAgentSubagentChildCompositionRequest,
): CodingAgentRuntimeCompositionOptions {
	const {
		mcpSource: _mcpSource,
		createPluginMcpRuntime: _createPluginMcpRuntime,
		extensionTools: _extensionTools,
		runtimeHostRetrySettings: _runtimeHostRetrySettings,
		...inheritedOptions
	} = parent;
	const promptResourceSource = parent.promptResourceSource
		? applySkillPolicy(parent.promptResourceSource, request.skillPolicy)
		: undefined;
	const createPromptRuntimeSources = parent.createPromptRuntimeSources
		? async (context: Parameters<NonNullable<typeof parent.createPromptRuntimeSources>>[0]) => {
				const sources = await parent.createPromptRuntimeSources!(context);
				return {
					...sources,
					resourceSource: applySkillPolicy(sources.resourceSource, request.skillPolicy),
				};
			}
		: undefined;
	return {
		...inheritedOptions,
		promptResourceSource,
		createPromptRuntimeSources,
		conversationDir: request.conversationDir,
		initialModel: request.initialModel,
		initialThinkingLevel: request.initialThinkingLevel,
		cwd: request.cwd,
		activation: request.activation,
		enableSubagents: false,
	};
}

function applySkillPolicy(
	source: CodingAgentPromptResourceSource,
	policy: CodingAgentSubagentSkillPolicy,
): CodingAgentPromptResourceSource {
	if (policy.mode === "inherit") return source;
	const allowedNames = policy.mode === "allow" ? new Set(policy.names) : undefined;
	return {
		getAgentsFiles: () => source.getAgentsFiles(),
		getAppendSystemPrompt: () => source.getAppendSystemPrompt(),
		getSkills: () => {
			const result = source.getSkills();
			return {
				...result,
				skills: allowedNames ? result.skills.filter(({ name }) => allowedNames.has(name)) : [],
			};
		},
		getSystemPrompt: () => source.getSystemPrompt(),
		refreshContextResourcesIfChanged: (signal) => source.refreshContextResourcesIfChanged(signal),
		refreshSkillsIfChanged: (signal) => source.refreshSkillsIfChanged(signal),
		setRuntimeSkillPaths: (paths, signal) => source.setRuntimeSkillPaths(paths, signal),
	};
}
