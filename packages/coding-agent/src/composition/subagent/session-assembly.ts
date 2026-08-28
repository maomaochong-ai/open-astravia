import type { Message } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import {
	type RuntimeActiveSession,
	type RuntimeObservationPublisher,
	type RuntimeResourceContext,
	runtimeObservationFailure,
	type SessionConfig,
} from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import { sessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import type {
	SubagentChildHandle,
	SubagentLifecycle,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentTypeDefinition,
	SubagentTypeRegistryLike,
} from "@vetta/runtime-subagents";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration, CodingAgentToolActivation } from "../../runtime-contracts/index.js";
import { CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION } from "../../runtime-contracts/subagent-observability.js";
import type {
	CodingAgentConversationSessionPathAssessment,
	CodingAgentSubagentChildFactory,
	CodingAgentSubagentChildFactoryContext,
	CodingAgentSubagentProfile,
	CodingAgentSubagentWorkspaceLease,
	CodingAgentSubagentWorkspacePort,
} from "../contracts/index.js";
import { createCodingAgentSubagentChildHandle } from "./child-handle.js";
import { createLocalSubagentId } from "./local-id.js";
import { buildSubagentNotification } from "./notification.js";
import { resolveCodingAgentSubagentProfile } from "./profile-policy.js";
import { createSubagentReportToParentToolRegistration, formatSubagentReport } from "./report-to-parent-tool.js";
import type { CodingAgentSubagentChildTodoBinding } from "./runtime.js";
import { CodingAgentSubagentRuntime } from "./runtime.js";
import { CODING_AGENT_SUBAGENTS_OBSERVATION } from "./subagent-session-extension-contract.js";

export type {
	CodingAgentSubagentChildFactory,
	CodingAgentSubagentChildFactoryContext,
} from "../contracts/index.js";

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
	readonly activation: CodingAgentToolActivation;
	readonly inheritedMcpView: McpRuntimeToolView;
	readonly skillPolicy: NonNullable<CodingAgentSubagentProfile["skillPolicy"]>;
}

export interface CodingAgentSubagentChildComposition {
	createSession(options: CodingAgentSubagentChildSessionOptions): Promise<RuntimeActiveSession>;
	resumeSession(options: CodingAgentSubagentChildSessionOptions): Promise<RuntimeActiveSession>;
	appendSessionContext(sessionId: string, records: readonly SessionContextRecord[]): void;
	deliverSessionContext(sessionId: string, records: readonly SessionContextRecord[]): Promise<void>;
	dispose(): Promise<void>;
}

export interface CodingAgentSubagentSessionAssemblyOptions {
	readonly enabled: boolean;
	readonly maxConcurrent?: number;
	readonly createEntryId?: () => string;
	readonly pathPort?: { dirname(path: string): string; join(...parts: readonly string[]): string };
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly readParentSessionId: () => string;
	readonly readParentSessionPath: () => string;
	readonly readParentMessages: () => Promise<readonly Message[]>;
	readonly readModel: () => NonNullable<SessionConfig["model"]>;
	readonly readThinkingLevel: () => NonNullable<SessionConfig["thinkingLevel"]>;
	readonly readInheritedMcpView: () => Promise<McpRuntimeToolView>;
	readonly readParentToolActivation?: () => CodingAgentToolActivation | undefined;
	readonly workspacePort?: CodingAgentSubagentWorkspacePort;
	readonly typeRegistry?: SubagentTypeRegistryLike<CodingAgentSubagentProfile>;
	readonly createChildFactory?: (context: CodingAgentSubagentChildFactoryContext) => CodingAgentSubagentChildFactory;
	readonly createChildComposition: (
		request: CodingAgentSubagentChildCompositionRequest,
	) => Promise<CodingAgentSubagentChildComposition>;
	readonly assessChildSessionPath: (
		conversationDir: string,
		sessionId: string,
		sessionPath: string,
	) => Promise<CodingAgentConversationSessionPathAssessment>;
	readonly hookRuntime: Pick<
		EcosystemHookRuntime,
		"recordAdditionalContexts" | "runSubagentStart" | "runSubagentStop"
	>;
	readonly resourceContext: Pick<RuntimeResourceContext, "deliverAsyncContext" | "reportObservation">;
	readonly observationPublisher?: RuntimeObservationPublisher;
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
		readParentToolActivation: options.readParentToolActivation ?? (() => undefined),
		workspacePort: options.workspacePort,
	});
	const reopenChild = childFactory?.reopen;
	return new CodingAgentSubagentRuntime({
		parentSessionId: options.readParentSessionId(),
		maxConcurrent: options.maxConcurrent,
		createEntryId: options.createEntryId ?? createLocalSubagentId,
		lifecycle,
		formatInitialMessage: formatCodingAgentSubagentTaskMessage,
		typeRegistry: options.typeRegistry,
		readParentMessages: options.readParentMessages,
		createChild: childFactory
			? (request, type, forkContext, todo, signal) =>
					childFactory.create(
						{
							...request,
							initialTodos: todo.initialItems,
							onTodoItemsChanged: todo.onItemsChanged,
						},
						type,
						forkContext,
						signal,
					)
			: (request, type, forkContext, todo) => openChild("create", request, type, forkContext, todo, options),
		reopenChild: childFactory
			? reopenChild
				? (snapshot, type, forkContext, todo, signal) =>
						reopenChild(snapshot, type, forkContext, signal, todo.onItemsChanged)
				: undefined
			: (snapshot, type, forkContext, todo) => openChild("resume", snapshot, type, forkContext, todo, options),
		validateRecoveredChild: (snapshot) =>
			validateRecoveredSubagentTranscript(
				snapshot,
				options.readParentSessionPath(),
				options.pathPort,
				options.assessChildSessionPath,
			),
		onRecoveryIssue: (_message) => {
			observeSubagentIssue(options, "recovery", {
				category: "error",
				errorName: "SubagentRecoveryIssue",
			});
		},
		onError: (error) => observeSubagentIssue(options, "coordinator", runtimeObservationFailure(error)),
		onNotify: (agents) => {
			const payload = buildSubagentNotification(agents);
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
					observeSubagentIssue(options, "notification-delivery", runtimeObservationFailure(error));
				});
		},
		onUpdate: (agents) => {
			void options.resourceContext
				.reportObservation({
					...sessionExtensionObservation(CODING_AGENT_SUBAGENTS_OBSERVATION, agents),
					source: "tool",
				})
				.catch((error: unknown) => {
					observeSubagentIssue(options, "session-observation", runtimeObservationFailure(error));
				});
		},
	});
}

function observeSubagentIssue(
	options: CodingAgentSubagentSessionAssemblyOptions,
	operation: "coordinator" | "recovery" | "notification-delivery" | "session-observation",
	failure: ReturnType<typeof runtimeObservationFailure>,
): void {
	options.observationPublisher?.record(CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION, { operation, failure });
}

function formatCodingAgentSubagentTaskMessage(snapshot: SubagentSnapshot, message: string): string {
	return [
		"<subagent_task>",
		`id: ${snapshot.id}`,
		`path: ${snapshot.path}`,
		`type: ${snapshot.agentType}`,
		`task_name: ${snapshot.taskName}`,
		"</subagent_task>",
		"",
		message,
	].join("\n");
}

async function openChild(
	operation: "create" | "resume",
	requestOrSnapshot: SubagentSpawnRequest | SubagentSnapshot,
	type: SubagentTypeDefinition<CodingAgentSubagentProfile>,
	forkContext: readonly Message[] | undefined,
	todo: CodingAgentSubagentChildTodoBinding,
	options: CodingAgentSubagentSessionAssemblyOptions,
): Promise<SubagentChildHandle> {
	const resolvedProfile = resolveCodingAgentSubagentProfile(
		type.profile,
		options.scenario,
		options.readParentToolActivation?.(),
	);
	const childSessionId =
		operation === "create"
			? (options.createEntryId ?? createLocalSubagentId)()
			: (requestOrSnapshot as SubagentSnapshot).id;
	const snapshot = operation === "resume" ? (requestOrSnapshot as SubagentSnapshot) : undefined;
	const workspaceLease = await acquireWorkspaceLease(
		options.cwd,
		childSessionId,
		requestOrSnapshot.taskName,
		resolvedProfile.workspacePolicy,
		options.workspacePort,
	);
	const childCwd = workspaceLease.cwd;
	const parentSessionId = options.readParentSessionId();
	const childConversationDir = snapshot?.sessionFile
		? dirname(snapshot.sessionFile, options.pathPort)
		: joinPath(
				dirname(options.readParentSessionPath(), options.pathPort),
				[".subagents", parentSessionId],
				options.pathPort,
			);
	const inheritedMcpView =
		resolvedProfile.mcpPolicy.mode === "inherit"
			? filterDeniedMcpTools(await options.readInheritedMcpView(), resolvedProfile.mcpPolicy.denyNamePrefixes)
			: EMPTY_MCP_TOOL_VIEW;
	const reportTool = createSubagentReportToParentToolRegistration({
		id: childSessionId,
		taskName: requestOrSnapshot.taskName,
		onReport: async (envelope) => {
			await options.resourceContext.deliverAsyncContext([
				{
					type: "subagent-report",
					content: [{ type: "text", text: formatSubagentReport(envelope) }],
					modelVisible: true,
					display: true,
				},
			]);
		},
	});
	const sessionRuntimeTools = filterDeniedRuntimeTools(
		[...(type.profile.createRuntimeTools?.(childCwd) ?? []), reportTool],
		resolvedProfile.mcpPolicy.mode === "inherit" ? resolvedProfile.mcpPolicy.denyNamePrefixes : undefined,
	);
	const additionallyEnabledToolNames = [
		...sessionRuntimeTools.map(({ tool }) => tool.name),
		...(resolvedProfile.todoPolicy.mode === "enabled" ? ["todo"] : []),
	];
	let childComposition: CodingAgentSubagentChildComposition;
	try {
		childComposition = await options.createChildComposition({
			conversationDir: childConversationDir,
			cwd: childCwd,
			initialModel: options.readModel(),
			initialThinkingLevel: options.readThinkingLevel(),
			activation: withAdditionalTools(
				withInheritedMcpTools(resolvedProfile.activation, inheritedMcpView),
				additionallyEnabledToolNames,
			),
			inheritedMcpView,
			skillPolicy: resolvedProfile.skillPolicy,
		});
	} catch (error) {
		await workspaceLease.release();
		throw error;
	}
	try {
		const childOptions: CodingAgentSubagentChildSessionOptions = {
			sessionId: childSessionId,
			cwd: childCwd,
			parentSessionPath: options.readParentSessionPath(),
			systemPromptAddon: type.profile.systemPromptAddon,
			forkContextMessages: operation === "create" ? forkContext : undefined,
			initialTodos:
				operation === "create" && resolvedProfile.todoPolicy.mode === "enabled" ? todo.initialItems : undefined,
			sessionRuntimeTools,
		};
		const childSession =
			operation === "create"
				? await childComposition.createSession(childOptions)
				: await childComposition.resumeSession(childOptions);
		const childSessionFile = childSession.sessionPath;
		return createCodingAgentSubagentChildHandle({
			session: childSession,
			sessionFile: childSessionFile,
			appendContext: (records) => childComposition.appendSessionContext(childSession.sessionId, records),
			deliverContext: (records) => childComposition.deliverSessionContext(childSession.sessionId, records),
			onTodoItemsChanged:
				resolvedProfile.todoPolicy.mode === "enabled" ? (items) => todo.onItemsChanged(items) : undefined,
			disposeComposition: async () => {
				try {
					await childComposition.dispose();
				} finally {
					await workspaceLease.release();
				}
			},
		});
	} catch (error) {
		try {
			await childComposition.dispose();
		} finally {
			await workspaceLease.release();
		}
		throw error;
	}
}

async function acquireWorkspaceLease(
	parentCwd: string,
	childId: string,
	taskName: string,
	policy: NonNullable<CodingAgentSubagentProfile["workspacePolicy"]>,
	port: CodingAgentSubagentWorkspacePort | undefined,
): Promise<CodingAgentSubagentWorkspaceLease> {
	if (policy.mode === "shared" || !port) {
		if (policy.mode === "isolated" && policy.fallback === "error") {
			throw new Error(`Subagent "${taskName}" requires an isolated workspace, but the host has no workspace port`);
		}
		return { cwd: parentCwd, mode: "shared", release: () => {} };
	}
	return await port.acquire({ parentCwd, childId, taskName, policy });
}

function withAdditionalTools(
	activation: CodingAgentToolActivation,
	toolNames: readonly string[],
): CodingAgentToolActivation {
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
	activation: CodingAgentToolActivation,
	inheritedView: McpRuntimeToolView,
): CodingAgentToolActivation {
	if (activation.mode === "scope" || inheritedView.tools.length === 0) return activation;
	return {
		mode: "explicit",
		toolNames: [...new Set([...activation.toolNames, ...inheritedView.tools.map(({ tool }) => tool.name)])],
	};
}

async function validateRecoveredSubagentTranscript(
	snapshot: SubagentSnapshot,
	parentSessionPath: string,
	pathPort: CodingAgentSubagentSessionAssemblyOptions["pathPort"],
	assessSessionPath: CodingAgentSubagentSessionAssemblyOptions["assessChildSessionPath"],
): Promise<string | undefined> {
	const sessionFile = snapshot.sessionFile;
	if (!sessionFile) return "Recovered subagent has no child session transcript";
	const expectedDirectory = joinPath(
		dirname(parentSessionPath, pathPort),
		[".subagents", snapshot.parentSessionId],
		pathPort,
	);
	const assessment = await assessSessionPath(expectedDirectory, snapshot.id, sessionFile);
	if (assessment === "valid") return undefined;
	if (assessment === "path-mismatch") {
		return "Recovered subagent transcript does not match the parent-owned session path";
	}
	return assessment === "not-file"
		? "Recovered subagent transcript is not a file"
		: "Recovered subagent transcript is missing";
}

function dirname(path: string, pathPort: CodingAgentSubagentSessionAssemblyOptions["pathPort"]): string {
	if (pathPort) return pathPort.dirname(path);
	const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (separatorIndex < 0) return ".";
	if (separatorIndex === 0) return path.slice(0, 1);
	return path.slice(0, separatorIndex);
}

function joinPath(
	base: string,
	parts: readonly string[],
	pathPort: CodingAgentSubagentSessionAssemblyOptions["pathPort"],
): string {
	if (pathPort) return pathPort.join(base, ...parts);
	const normalizedBase = base.replace(/[\\/]+$/u, "");
	// Hosts with a real path port still own canonical normalization.
	const separator = base.includes("\\") ? "\\" : "/";
	return [normalizedBase || ".", ...parts].join(separator);
}

const EMPTY_MCP_TOOL_VIEW: McpRuntimeToolView = Object.freeze({ tools: Object.freeze([]) });
