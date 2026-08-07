import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Message } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type {
	ConversationScenario,
	GreenfieldRuntimeResourceContext,
	GreenfieldRuntimeSession,
	SessionConfig,
} from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import { FileConversationRepository } from "@vetta/runtime-storage/conversation";
import type {
	SubagentChildHandle,
	SubagentLifecycle,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentTypeDefinition,
	SubagentTypeRegistryLike,
} from "@vetta/runtime-subagents";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { createCodingAgentSubagentChildHandle } from "./child-handle.js";
import { type CodingAgentSubagentProfile, CodingAgentSubagentRuntime } from "./runtime.js";

export interface CodingAgentSubagentChildSessionOptions {
	readonly sessionId: string;
	readonly cwd: string;
	readonly parentSessionPath: string;
	readonly systemPromptAddon: string;
	readonly forkContextMessages?: readonly Message[];
	readonly initialTodos?: readonly string[];
	readonly sessionRuntimeTools?: readonly CodingAgentRuntimeToolRegistration[];
}

export interface CodingAgentSubagentChildCompositionRequest {
	readonly conversationDir: string;
	readonly cwd: string;
	readonly initialModel: NonNullable<SessionConfig["model"]>;
	readonly initialThinkingLevel: NonNullable<SessionConfig["thinkingLevel"]>;
	readonly activation: CodingToolActivation;
	readonly inheritedMcpView: McpRuntimeToolView;
}

export interface CodingAgentSubagentChildComposition {
	createSession(options: CodingAgentSubagentChildSessionOptions): Promise<GreenfieldRuntimeSession>;
	resumeSession(options: CodingAgentSubagentChildSessionOptions): Promise<GreenfieldRuntimeSession>;
	appendSessionContext(sessionId: string, records: readonly SessionContextRecord[]): void;
	deliverSessionContext(sessionId: string, records: readonly SessionContextRecord[]): Promise<void>;
	dispose(): Promise<void>;
}

export interface CodingAgentSubagentSessionAssemblyOptions {
	readonly enabled: boolean;
	readonly maxConcurrent?: number;
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly readParentSessionId: () => string;
	readonly readParentSessionPath: () => string;
	readonly readParentMessages: () => Promise<readonly Message[]>;
	readonly readModel: () => NonNullable<SessionConfig["model"]>;
	readonly readThinkingLevel: () => NonNullable<SessionConfig["thinkingLevel"]>;
	readonly readInheritedMcpView: () => Promise<McpRuntimeToolView>;
	readonly typeRegistry?: SubagentTypeRegistryLike<CodingAgentSubagentProfile>;
	readonly createChildFactory?: (context: CodingAgentSubagentChildFactoryContext) => CodingAgentSubagentChildFactory;
	readonly createChildComposition: (
		request: CodingAgentSubagentChildCompositionRequest,
	) => Promise<CodingAgentSubagentChildComposition>;
	readonly hookRuntime: Pick<
		EcosystemHookRuntime,
		"recordAdditionalContexts" | "runSubagentStart" | "runSubagentStop"
	>;
	readonly resourceContext: Pick<GreenfieldRuntimeResourceContext, "deliverAsyncContext" | "reportObservation">;
}

export interface CodingAgentSubagentChildFactoryContext {
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly readParentSessionId: () => string;
	readonly readParentSessionPath: () => string;
	readonly readModel: () => NonNullable<SessionConfig["model"]>;
	readonly readThinkingLevel: () => NonNullable<SessionConfig["thinkingLevel"]>;
	readonly readInheritedMcpView: () => Promise<McpRuntimeToolView>;
}

export interface CodingAgentSubagentChildFactory {
	create(
		request: SubagentSpawnRequest,
		type: SubagentTypeDefinition<CodingAgentSubagentProfile>,
		forkContext: readonly Message[] | undefined,
		signal?: AbortSignal,
	): Promise<SubagentChildHandle>;
	reopen?(
		snapshot: SubagentSnapshot,
		type: SubagentTypeDefinition<CodingAgentSubagentProfile>,
		forkContext: readonly Message[] | undefined,
		signal?: AbortSignal,
	): Promise<SubagentChildHandle>;
}

/** 组装单个父 Session 的 Subagent 能力；Composition Root 只提供宿主端口。 */
export function createCodingAgentSubagentSessionAssembly(
	options: CodingAgentSubagentSessionAssemblyOptions,
): CodingAgentSubagentRuntime | undefined {
	if (!options.enabled) return undefined;

	const lifecycle = createSubagentLifecycle(options);
	const childFactory = options.createChildFactory?.({
		cwd: options.cwd,
		scenario: options.scenario,
		readParentSessionId: options.readParentSessionId,
		readParentSessionPath: options.readParentSessionPath,
		readModel: options.readModel,
		readThinkingLevel: options.readThinkingLevel,
		readInheritedMcpView: options.readInheritedMcpView,
	});
	const reopenChild = childFactory?.reopen;
	return new CodingAgentSubagentRuntime({
		parentSessionId: options.readParentSessionId(),
		maxConcurrent: options.maxConcurrent,
		lifecycle,
		typeRegistry: options.typeRegistry,
		readParentMessages: options.readParentMessages,
		createChild: childFactory
			? (request, type, forkContext, signal) => childFactory.create(request, type, forkContext, signal)
			: (request, type, forkContext) => openChild("create", request, type, forkContext, options),
		reopenChild: childFactory
			? reopenChild
				? (snapshot, type, forkContext, signal) => reopenChild(snapshot, type, forkContext, signal)
				: undefined
			: (snapshot, type, forkContext) => openChild("resume", snapshot, type, forkContext, options),
		validateRecoveredChild: (snapshot) =>
			validateRecoveredSubagentTranscript(snapshot, options.readParentSessionPath()),
		onRecoveryIssue: (message) => {
			console.warn("[greenfield-runtime] subagent recovery issue", message);
		},
		onNotify: (payload) => {
			void options.resourceContext
				.deliverAsyncContext([
					{
						type: "subagent-notification",
						content: [{ type: "text", text: payload.text }],
						modelVisible: true,
						display: true,
					},
				])
				.catch((error: unknown) => {
					console.warn("[greenfield-runtime] failed to deliver subagent notification", error);
				});
		},
		onUpdate: (agents) => {
			void options.resourceContext
				.reportObservation({
					type: "subagents_update",
					agents: agents.map(toSubagentInfo),
					source: "tool",
				})
				.catch((error: unknown) => {
					console.warn("[greenfield-runtime] failed to publish subagent observation", error);
				});
		},
	});
}

async function openChild(
	operation: "create" | "resume",
	requestOrSnapshot: SubagentSpawnRequest | SubagentSnapshot,
	type: SubagentTypeDefinition<CodingAgentSubagentProfile>,
	forkContext: readonly Message[] | undefined,
	options: CodingAgentSubagentSessionAssemblyOptions,
): Promise<SubagentChildHandle> {
	const childSessionId = operation === "create" ? randomUUID() : (requestOrSnapshot as SubagentSnapshot).id;
	const snapshot = operation === "resume" ? (requestOrSnapshot as SubagentSnapshot) : undefined;
	const parentSessionId = options.readParentSessionId();
	const childConversationDir = snapshot?.sessionFile
		? dirname(snapshot.sessionFile)
		: join(dirname(options.readParentSessionPath()), ".subagents", parentSessionId);
	const inheritedMcpView = type.profile.inheritParentMcp
		? filterDeniedMcpTools(await options.readInheritedMcpView(), type.profile.denyToolNamePrefixes)
		: EMPTY_MCP_TOOL_VIEW;
	const sessionRuntimeTools = filterDeniedRuntimeTools(
		type.profile.createRuntimeTools?.(options.cwd) ?? [],
		type.profile.denyToolNamePrefixes,
	);
	const additionallyEnabledToolNames = [
		...sessionRuntimeTools.map(({ tool }) => tool.name),
		...(type.profile.includeTodo ? ["todo"] : []),
	];
	const childComposition = await options.createChildComposition({
		conversationDir: childConversationDir,
		cwd: options.cwd,
		initialModel: options.readModel(),
		initialThinkingLevel: options.readThinkingLevel(),
		activation: withAdditionalTools(
			withInheritedMcpTools(withScenario(type.profile.activation, options.scenario), inheritedMcpView),
			additionallyEnabledToolNames,
		),
		inheritedMcpView,
	});
	try {
		const childOptions: CodingAgentSubagentChildSessionOptions = {
			sessionId: childSessionId,
			cwd: options.cwd,
			parentSessionPath: options.readParentSessionPath(),
			systemPromptAddon: type.profile.systemPromptAddon,
			forkContextMessages: operation === "create" ? forkContext : undefined,
			initialTodos:
				operation === "create" && type.profile.includeTodo
					? (requestOrSnapshot as SubagentSpawnRequest).todos
					: undefined,
			sessionRuntimeTools,
		};
		const childSession =
			operation === "create"
				? await childComposition.createSession(childOptions)
				: await childComposition.resumeSession(childOptions);
		const childSessionFile = childSession.createCoreAssembly().lifecycle.sessionPath;
		return createCodingAgentSubagentChildHandle({
			session: childSession,
			sessionFile: childSessionFile,
			appendContext: (records) => childComposition.appendSessionContext(childSession.sessionId, records),
			deliverContext: (records) => childComposition.deliverSessionContext(childSession.sessionId, records),
			disposeComposition: () => childComposition.dispose(),
		});
	} catch (error) {
		await childComposition.dispose();
		throw error;
	}
}

function withAdditionalTools(activation: CodingToolActivation, toolNames: readonly string[]): CodingToolActivation {
	if (toolNames.length === 0) return activation;
	if (activation.mode === "explicit") {
		return { mode: "explicit", toolNames: [...new Set([...activation.toolNames, ...toolNames])] };
	}
	return {
		...activation,
		additionallyEnabledToolNames: [...new Set([...(activation.additionallyEnabledToolNames ?? []), ...toolNames])],
	};
}

function filterDeniedRuntimeTools(
	registrations: readonly CodingAgentRuntimeToolRegistration[],
	prefixes: readonly string[] | undefined,
): readonly CodingAgentRuntimeToolRegistration[] {
	if (!prefixes || prefixes.length === 0) return registrations;
	return registrations.filter(({ tool }) => !prefixes.some((prefix) => tool.name.startsWith(prefix)));
}

function filterDeniedMcpTools(view: McpRuntimeToolView, prefixes: readonly string[] | undefined): McpRuntimeToolView {
	if (!prefixes || prefixes.length === 0) return view;
	return {
		tools: view.tools.filter(({ tool }) => !prefixes.some((prefix) => tool.name.startsWith(prefix))),
	};
}

function createSubagentLifecycle(options: CodingAgentSubagentSessionAssemblyOptions): SubagentLifecycle {
	return {
		beforeStart: async ({ id, agentType, message }) => {
			const outcome = await options.hookRuntime.runSubagentStart(
				{ agentId: id, agentType },
				`${options.readParentSessionId()}:subagent-start:${id}`,
			);
			await options.hookRuntime.recordAdditionalContexts(outcome.additionalContexts);
			if (outcome.shouldStop || outcome.shouldBlock) {
				return {
					blockedReason:
						outcome.stopReason ?? outcome.blockReason ?? "SubagentStart ecosystem hook blocked subagent spawn",
				};
			}
			return outcome.additionalContexts.length > 0
				? { message: `${outcome.additionalContexts.join("\n\n")}\n\n${message}` }
				: undefined;
		},
		beforeStop: async ({
			id,
			agentType,
			generation,
			stopHookActive,
			lastAssistantText,
			sessionFile,
			interrupted,
		}) => {
			const outcome = await options.hookRuntime.runSubagentStop({
				agentId: id,
				agentType,
				turnId: `${options.readParentSessionId()}:subagent-stop:${id}:${generation}`,
				stopHookActive,
				lastAssistantMessage: lastAssistantText ?? null,
				agentTranscriptPath: sessionFile ?? null,
			});
			await options.hookRuntime.recordAdditionalContexts(outcome.additionalContexts);
			if (!interrupted && outcome.shouldBlock && !outcome.shouldStop && outcome.continuationFragments.length > 0) {
				return { continuation: outcome.continuationFragments.join("\n\n") };
			}
			return undefined;
		},
	};
}

function withInheritedMcpTools(
	activation: CodingToolActivation,
	inheritedView: McpRuntimeToolView,
): CodingToolActivation {
	if (activation.mode === "scope" || inheritedView.tools.length === 0) return activation;
	return {
		mode: "explicit",
		toolNames: [...new Set([...activation.toolNames, ...inheritedView.tools.map(({ tool }) => tool.name)])],
	};
}

function withScenario(activation: CodingToolActivation, scenario: ConversationScenario): CodingToolActivation {
	return activation.mode === "scope" ? { ...activation, scope: scenario } : activation;
}

function toSubagentInfo(snapshot: SubagentSnapshot): Omit<SubagentSnapshot, "usage"> {
	const { usage: _usage, ...info } = snapshot;
	return info;
}

async function validateRecoveredSubagentTranscript(
	snapshot: SubagentSnapshot,
	parentSessionPath: string,
): Promise<string | undefined> {
	const sessionFile = snapshot.sessionFile;
	if (!sessionFile) return "Recovered subagent has no child session transcript";
	const expectedDirectory = resolve(dirname(parentSessionPath), ".subagents", snapshot.parentSessionId);
	const resolvedSessionFile = resolve(sessionFile);
	const childRepository = new FileConversationRepository({ rootDir: expectedDirectory });
	const expectedSessionFile = childRepository.resolveConversationPath(snapshot.id);
	await childRepository.close();
	if (resolvedSessionFile !== expectedSessionFile) {
		return "Recovered subagent transcript does not match the parent-owned session path";
	}
	try {
		const metadata = await stat(resolvedSessionFile);
		return metadata.isFile() ? undefined : "Recovered subagent transcript is not a file";
	} catch {
		return "Recovered subagent transcript is missing";
	}
}

const EMPTY_MCP_TOOL_VIEW: McpRuntimeToolView = Object.freeze({ tools: Object.freeze([]) });
