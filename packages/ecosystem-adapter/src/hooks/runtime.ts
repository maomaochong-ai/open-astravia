import type {
	CompactionTrigger,
	EcosystemHookContributionSource,
	HookContributionLease,
	HookDispatchOutcome,
	HookPermissionMode,
	SessionEndCause,
	SessionStartSource,
	SubagentHookContext,
} from "./types.js";

export interface EcosystemToolDescriptor {
	hostName: string;
	kind: "function" | "shell" | "mcp" | "file-edit" | "agent" | "custom";
	source?: {
		ecosystem?: string;
		serverName?: string;
		originalName?: string;
	};
}

interface EcosystemHookEventBase {
	sessionId: string;
	cwd: string;
	transcriptPath: string | null;
	model: string;
	permissionMode: HookPermissionMode;
	subagent?: SubagentHookContext;
}

export interface EcosystemSessionStartEvent extends EcosystemHookEventBase {
	eventName: "SessionStart";
	source: SessionStartSource;
}

export interface EcosystemSessionEndEvent extends EcosystemHookEventBase {
	eventName: "SessionEnd";
	cause: SessionEndCause;
}

export interface EcosystemUserPromptSubmitEvent extends EcosystemHookEventBase {
	eventName: "UserPromptSubmit";
	turnId: string;
	prompt: string;
}

export interface EcosystemPreToolUseEvent extends EcosystemHookEventBase {
	eventName: "PreToolUse";
	turnId: string;
	tool: EcosystemToolDescriptor;
	toolUseId: string;
	toolInput: unknown;
}

export interface EcosystemPostToolUseEvent extends EcosystemHookEventBase {
	eventName: "PostToolUse";
	turnId: string;
	tool: EcosystemToolDescriptor;
	toolUseId: string;
	toolInput: unknown;
	toolResponse: unknown;
}

export interface EcosystemPostToolUseFailureEvent extends EcosystemHookEventBase {
	eventName: "PostToolUseFailure";
	turnId: string;
	tool: EcosystemToolDescriptor;
	toolUseId: string;
	toolInput: unknown;
	error: string;
	isInterrupt?: boolean;
	durationMs?: number;
}

export interface EcosystemPermissionRequestEvent extends EcosystemHookEventBase {
	eventName: "PermissionRequest";
	turnId: string;
	tool: EcosystemToolDescriptor;
	toolInput: unknown;
	runIdSuffix: string;
}

export interface EcosystemCompactEvent extends EcosystemHookEventBase {
	eventName: "PreCompact" | "PostCompact";
	turnId: string;
	trigger: CompactionTrigger;
}

export interface EcosystemSubagentStartEvent extends EcosystemHookEventBase, SubagentHookContext {
	eventName: "SubagentStart";
	turnId: string;
}

export interface EcosystemSubagentStopEvent extends EcosystemHookEventBase, SubagentHookContext {
	eventName: "SubagentStop";
	turnId: string;
	stopHookActive: boolean;
	lastAssistantMessage: string | null;
	agentTranscriptPath: string | null;
}

export interface EcosystemStopEvent extends EcosystemHookEventBase {
	eventName: "Stop";
	turnId: string;
	stopHookActive: boolean;
	lastAssistantMessage: string | null;
}

export type EcosystemHookEvent =
	| EcosystemSessionStartEvent
	| EcosystemSessionEndEvent
	| EcosystemUserPromptSubmitEvent
	| EcosystemPreToolUseEvent
	| EcosystemPermissionRequestEvent
	| EcosystemPostToolUseEvent
	| EcosystemPostToolUseFailureEvent
	| EcosystemCompactEvent
	| EcosystemSubagentStartEvent
	| EcosystemSubagentStopEvent
	| EcosystemStopEvent;

export interface EcosystemHookAdapter {
	readonly id: string;
	supports(event: EcosystemHookEvent): boolean;
	dispatch(event: EcosystemHookEvent, signal?: AbortSignal): Promise<HookDispatchOutcome>;
	registerContribution?(source: EcosystemHookContributionSource): Promise<HookContributionLease>;
	resetSessionState?(): void;
}

export interface EcosystemHookHost {
	readonly cwd: string;
	getSessionId(): string;
	getTranscriptPath(): string | null;
	getModelId(): string;
	getPermissionMode?(): HookPermissionMode;
	recordAdditionalContexts?(contexts: readonly string[]): void | Promise<void>;
	abortCurrentRun(): void;
}

export interface EcosystemHookRuntimeOptions {
	host: EcosystemHookHost;
	initialSessionStartSource: SessionStartSource;
	loadAdapters: () => Promise<readonly EcosystemHookAdapter[]>;
	maxStopContinuations?: number;
}

const DEFAULT_MAX_STOP_CONTINUATIONS = 8;

export class EcosystemHookRuntime {
	private readonly host: EcosystemHookHost;
	private readonly loadAdapters: () => Promise<readonly EcosystemHookAdapter[]>;
	private adaptersPromise: Promise<readonly EcosystemHookAdapter[]> | undefined;
	private readonly maxStopContinuations: number;
	private pendingSessionStart: SessionStartSource | undefined;
	private currentTurnId: string | undefined;
	private turnSequence = 0;
	private stopHookActive = false;
	private stopContinuationCount = 0;
	private readonly currentTurnContributions = new Map<string, { revision: string; lease: HookContributionLease }>();
	private resetAdaptersBeforeSessionStart = false;

	constructor(options: EcosystemHookRuntimeOptions) {
		this.host = options.host;
		this.pendingSessionStart = options.initialSessionStartSource;
		this.maxStopContinuations = options.maxStopContinuations ?? DEFAULT_MAX_STOP_CONTINUATIONS;
		this.loadAdapters = options.loadAdapters;
	}

	markSessionStart(source: SessionStartSource): void {
		this.pendingSessionStart = source;
		this.finishTurn();
		this.resetAdaptersBeforeSessionStart = true;
	}

	async runPendingSessionStart(signal?: AbortSignal): Promise<HookDispatchOutcome | undefined> {
		const source = this.pendingSessionStart;
		if (!source) return undefined;
		this.pendingSessionStart = undefined;
		if (this.resetAdaptersBeforeSessionStart) {
			const adapters = await this.getAdapters();
			for (const adapter of adapters) adapter.resetSessionState?.();
			this.resetAdaptersBeforeSessionStart = false;
		}
		return this.dispatch({ ...this.baseEvent(), eventName: "SessionStart", source }, signal);
	}

	/**
	 * Best-effort session teardown hook. Cannot block session end.
	 * `cause` is Vetta-native ({@link SessionEndCause}); Claude wire `reason` is mapped only in the Claude profile.
	 * Captures session id / transcript path synchronously via {@link baseEvent}.
	 */
	async runSessionEnd(cause: SessionEndCause, signal?: AbortSignal): Promise<HookDispatchOutcome> {
		try {
			return await this.dispatch({ ...this.baseEvent(), eventName: "SessionEnd", cause }, signal);
		} finally {
			this.finishTurn();
		}
	}

	async runUserPromptSubmit(
		prompt: string,
		signal?: AbortSignal,
		contributions: readonly EcosystemHookContributionSource[] = [],
	): Promise<HookDispatchOutcome> {
		const turnId = `${this.host.getSessionId()}:turn-${++this.turnSequence}`;
		this.currentTurnId = turnId;
		this.stopHookActive = false;
		this.stopContinuationCount = 0;
		for (const contribution of contributions) await this.registerCurrentTurnContribution(contribution);
		const outcome = await this.dispatch(
			{ ...this.baseEvent(), eventName: "UserPromptSubmit", turnId, prompt },
			signal,
		);
		if (outcome.shouldStop || outcome.shouldBlock) this.finishTurn();
		return outcome;
	}

	async registerCurrentTurnContribution(source: EcosystemHookContributionSource): Promise<boolean> {
		this.ensureTurnId();
		const existing = this.currentTurnContributions.get(source.id);
		if (existing?.revision === source.revision) return true;

		const adapters = await this.getAdapters();
		const adapter = adapters.find(
			(candidate) => candidate.id === source.profileId && candidate.registerContribution !== undefined,
		);
		if (!adapter?.registerContribution) return false;
		const lease = await adapter.registerContribution(source);
		this.currentTurnContributions.set(source.id, { revision: source.revision, lease });
		existing?.lease.release();
		return true;
	}

	finishCurrentTurn(): void {
		this.finishTurn();
	}

	async runPreToolUse(
		toolUseId: string,
		tool: EcosystemToolDescriptor | string,
		toolInput: unknown,
		signal?: AbortSignal,
	): Promise<HookDispatchOutcome> {
		return this.dispatch(
			{
				...this.baseEvent(),
				eventName: "PreToolUse",
				turnId: this.ensureTurnId(),
				tool: normalizeToolDescriptor(tool),
				toolUseId,
				toolInput,
			},
			signal,
		);
	}

	async runPostToolUse(
		toolUseId: string,
		tool: EcosystemToolDescriptor | string,
		toolInput: unknown,
		toolResponse: unknown,
		signal?: AbortSignal,
	): Promise<HookDispatchOutcome> {
		const outcome = await this.dispatch(
			{
				...this.baseEvent(),
				eventName: "PostToolUse",
				turnId: this.ensureTurnId(),
				tool: normalizeToolDescriptor(tool),
				toolUseId,
				toolInput,
				toolResponse,
			},
			signal,
		);
		if (outcome.shouldStop) this.host.abortCurrentRun();
		return outcome;
	}

	/**
	 * Fires after a tool call throws / fails. Cannot undo tool side effects.
	 * May return additional context or feedback for the model.
	 */
	async runPostToolUseFailure(
		toolUseId: string,
		tool: EcosystemToolDescriptor | string,
		toolInput: unknown,
		error: string,
		options?: { isInterrupt?: boolean; durationMs?: number; signal?: AbortSignal },
	): Promise<HookDispatchOutcome> {
		return this.dispatch(
			{
				...this.baseEvent(),
				eventName: "PostToolUseFailure",
				turnId: this.ensureTurnId(),
				tool: normalizeToolDescriptor(tool),
				toolUseId,
				toolInput,
				error,
				isInterrupt: options?.isInterrupt,
				durationMs: options?.durationMs,
			},
			options?.signal,
		);
	}

	async runPermissionRequest(
		runIdSuffix: string,
		tool: EcosystemToolDescriptor | string,
		toolInput: unknown,
		signal?: AbortSignal,
	): Promise<HookDispatchOutcome> {
		return this.dispatch(
			{
				...this.baseEvent(),
				eventName: "PermissionRequest",
				turnId: this.ensureTurnId(),
				tool: normalizeToolDescriptor(tool),
				toolInput,
				runIdSuffix,
			},
			signal,
		);
	}

	async runPreCompact(trigger: CompactionTrigger, signal?: AbortSignal): Promise<HookDispatchOutcome> {
		return this.dispatch(
			{ ...this.baseEvent(), eventName: "PreCompact", turnId: this.ensureTurnId(), trigger },
			signal,
		);
	}

	async runPostCompact(trigger: CompactionTrigger, signal?: AbortSignal): Promise<HookDispatchOutcome> {
		const outcome = await this.dispatch(
			{ ...this.baseEvent(), eventName: "PostCompact", turnId: this.ensureTurnId(), trigger },
			signal,
		);
		if (outcome.shouldStop) this.host.abortCurrentRun();
		return outcome;
	}

	async runSubagentStart(
		context: SubagentHookContext,
		turnId: string,
		signal?: AbortSignal,
	): Promise<HookDispatchOutcome> {
		return this.dispatch({ ...this.baseEvent(), ...context, eventName: "SubagentStart", turnId }, signal);
	}

	async runSubagentStop(
		context: SubagentHookContext & {
			turnId: string;
			stopHookActive: boolean;
			lastAssistantMessage: string | null;
			agentTranscriptPath: string | null;
		},
		signal?: AbortSignal,
	): Promise<HookDispatchOutcome> {
		return this.dispatch({ ...this.baseEvent(), ...context, eventName: "SubagentStop" }, signal);
	}

	async recordAdditionalContexts(contexts: readonly string[]): Promise<void> {
		if (contexts.length === 0) return;
		await this.host.recordAdditionalContexts?.(contexts);
	}

	async runStop(lastAssistantMessage: string | null, signal?: AbortSignal): Promise<string[]> {
		if (!this.currentTurnId) return [];
		if (this.stopContinuationCount >= this.maxStopContinuations) {
			console.warn(`[ecosystem-hooks] Stop continuation limit reached (${this.maxStopContinuations})`);
			this.finishTurn();
			return [];
		}

		const outcome = await this.dispatch(
			{
				...this.baseEvent(),
				eventName: "Stop",
				turnId: this.currentTurnId,
				stopHookActive: this.stopHookActive,
				lastAssistantMessage,
			},
			signal,
		);
		if (outcome.shouldStop || !outcome.shouldBlock || outcome.continuationFragments.length === 0) {
			this.finishTurn();
			return [];
		}

		this.stopHookActive = true;
		this.stopContinuationCount++;
		return outcome.continuationFragments;
	}

	private async dispatch(event: EcosystemHookEvent, signal?: AbortSignal): Promise<HookDispatchOutcome> {
		const adapters = await this.getAdapters();
		const supported = adapters.filter((adapter) => adapter.supports(event));
		if (supported.length === 0) return emptyHookDispatchOutcome();
		const outcomes = await Promise.all(
			supported.map(async (adapter) => {
				try {
					return await adapter.dispatch(event, signal);
				} catch (error) {
					console.warn(`[ecosystem-hooks] adapter ${adapter.id} failed`, error);
					return emptyHookDispatchOutcome();
				}
			}),
		);
		return aggregateHookDispatchOutcomes(outcomes);
	}

	private getAdapters(): Promise<readonly EcosystemHookAdapter[]> {
		this.adaptersPromise ??= this.loadAdapters().catch((error) => {
			console.warn("[ecosystem-hooks] failed to load hook adapters", error);
			return [];
		});
		return this.adaptersPromise;
	}

	private baseEvent(): EcosystemHookEventBase {
		return {
			sessionId: this.host.getSessionId(),
			cwd: this.host.cwd,
			transcriptPath: this.host.getTranscriptPath(),
			model: this.host.getModelId(),
			permissionMode: this.host.getPermissionMode?.() ?? "default",
		};
	}

	private ensureTurnId(): string {
		this.currentTurnId ??= `${this.host.getSessionId()}:turn-${++this.turnSequence}`;
		return this.currentTurnId;
	}

	private finishTurn(): void {
		for (const contribution of this.currentTurnContributions.values()) contribution.lease.release();
		this.currentTurnContributions.clear();
		this.currentTurnId = undefined;
		this.stopHookActive = false;
		this.stopContinuationCount = 0;
	}
}

export function emptyHookDispatchOutcome(): HookDispatchOutcome {
	return {
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		continuationFragments: [],
		runs: [],
	};
}

/** Shared deterministic aggregation for built-in and host-provided Hook adapters. */
export function aggregateHookDispatchOutcomes(outcomes: readonly HookDispatchOutcome[]): HookDispatchOutcome {
	const shouldStop = outcomes.some((outcome) => outcome.shouldStop);
	const shouldBlock = !shouldStop && outcomes.some((outcome) => outcome.shouldBlock);
	const permissionDecision = outcomes.some((outcome) => outcome.permissionDecision === "deny")
		? "deny"
		: outcomes.some((outcome) => outcome.permissionDecision === "allow")
			? "allow"
			: undefined;
	return {
		shouldStop,
		stopReason: outcomes.find((outcome) => outcome.stopReason)?.stopReason,
		shouldBlock,
		blockReason: shouldBlock ? outcomes.find((outcome) => outcome.blockReason)?.blockReason : undefined,
		additionalContexts: outcomes.flatMap((outcome) => outcome.additionalContexts),
		feedbackMessage: joinNonEmpty(outcomes.map((outcome) => outcome.feedbackMessage)),
		continuationFragments: shouldStop ? [] : outcomes.flatMap((outcome) => outcome.continuationFragments),
		updatedToolInput: shouldStop || shouldBlock ? undefined : findLastDefined(outcomes, "updatedToolInput"),
		permissionDecision,
		permissionMessage: outcomes.find((outcome) => outcome.permissionDecision === permissionDecision)
			?.permissionMessage,
		runs: outcomes.flatMap((outcome) => outcome.runs),
	};
}

function normalizeToolDescriptor(tool: EcosystemToolDescriptor | string): EcosystemToolDescriptor {
	return typeof tool === "string" ? { hostName: tool, kind: inferToolKind(tool) } : tool;
}

function inferToolKind(toolName: string): EcosystemToolDescriptor["kind"] {
	if (toolName === "bash" || toolName === "shell") return "shell";
	if (toolName === "edit" || toolName === "write") return "file-edit";
	if (toolName === "spawn_agent") return "agent";
	if (toolName.startsWith("mcp_")) return "mcp";
	return "function";
}

function findLastDefined<K extends keyof HookDispatchOutcome>(
	outcomes: readonly HookDispatchOutcome[],
	key: K,
): HookDispatchOutcome[K] | undefined {
	for (let index = outcomes.length - 1; index >= 0; index--) {
		const value = outcomes[index][key];
		if (value !== undefined) return value;
	}
	return undefined;
}

function joinNonEmpty(values: readonly (string | undefined)[]): string | undefined {
	const filtered = values.filter((value): value is string => value !== undefined && value.length > 0);
	return filtered.length > 0 ? filtered.join("\n\n") : undefined;
}
