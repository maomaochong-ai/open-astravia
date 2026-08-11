export const HOOK_EVENT_NAMES = [
	"SessionStart",
	"SessionEnd",
	"UserPromptSubmit",
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"PostToolUseFailure",
	"PreCompact",
	"PostCompact",
	"SubagentStart",
	"SubagentStop",
	"Stop",
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];
export type HookPermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
export type SessionStartSource = "startup" | "resume" | "clear" | "compact";
/**
 * Vetta-native reason the current session is ending.
 * Host and neutral runtime use only these values — never Claude/Codex wire strings.
 * Claude stdin `reason` / settings matchers are produced only in the Claude profile.
 */
export type SessionEndCause =
	/** Host creates a brand-new session (replaces the current one). */
	| "new_session"
	/** Host switches to another existing session file. */
	| "switch_session"
	/** Host forks the conversation into a new branched session. */
	| "fork_session"
	/** AgentSession / runtime is disposed (process teardown, UI closed session). */
	| "dispose";
export type CompactionTrigger = "manual" | "auto";
export type HookRunStatus = "Running" | "Completed" | "Failed" | "Blocked" | "Stopped";
export type HookOutputEntryKind = "Warning" | "Stop" | "Feedback" | "Context" | "Error";

export interface HookConfigLayer {
	directory: string;
	enabled: boolean;
	label?: string;
	sources?: readonly HookConfigSource[];
}

export interface HookConfigSource {
	path: string;
	env?: Readonly<Record<string, string>>;
	pluginId?: string;
	/**
	 * Optional profile ownership. When set, only the matching adapter loads this source.
	 * Example values: `codex-hooks/fca51f6`, `claude-code-hooks/2.1.211`.
	 */
	profileId?: string;
}

export interface HookDiagnostic {
	code:
		| "config_read_failed"
		| "config_parse_failed"
		| "invalid_matcher"
		| "invalid_handler"
		| "unsupported_handler_type"
		| "unsupported_handler_mode"
		| "unsupported_event"
		| "untrusted_handler"
		| "unsupported_runtime";
	message: string;
	sourcePath: string;
}

export interface ConfiguredHookHandler {
	eventName: HookEventName;
	matcher?: string;
	command: string;
	timeoutMs: number;
	statusMessage?: string;
	sourcePath: string;
	displayOrder: number;
	env?: Readonly<Record<string, string>>;
	pluginId?: string;
	once?: boolean;
}

export interface HookHandlerContribution {
	id: string;
	revision: string;
	handlers: readonly ConfiguredHookHandler[];
}

export interface HookContributionLease {
	release(): void;
}

export interface EcosystemHookContributionSource {
	id: string;
	revision: string;
	profileId: string;
	sourcePath: string;
	configuration: unknown;
	env?: Readonly<Record<string, string>>;
	pluginId?: string;
}

export interface SubagentHookContext {
	agentId: string;
	agentType: string;
}

export interface HookToolIdentity {
	name: string;
	matcherAliases: readonly string[];
}

interface HookRequestBase {
	sessionId: string;
	turnId?: string;
	cwd: string;
	transcriptPath: string | null;
	model: string;
	permissionMode: HookPermissionMode;
}

export interface SessionStartHookRequest extends HookRequestBase {
	eventName: "SessionStart";
	source: SessionStartSource;
}

export interface SessionEndHookRequest extends HookRequestBase {
	eventName: "SessionEnd";
	/** Vetta-native end cause; profile maps to ecosystem wire fields if needed. */
	cause: SessionEndCause;
}

export interface UserPromptSubmitHookRequest extends HookRequestBase {
	eventName: "UserPromptSubmit";
	turnId: string;
	prompt: string;
	subagent?: SubagentHookContext;
}

export interface PreToolUseHookRequest extends HookRequestBase {
	eventName: "PreToolUse";
	turnId: string;
	tool: HookToolIdentity;
	toolUseId: string;
	toolInput: unknown;
	subagent?: SubagentHookContext;
}

export interface PermissionRequestHookRequest extends HookRequestBase {
	eventName: "PermissionRequest";
	turnId: string;
	tool: HookToolIdentity;
	toolInput: unknown;
	runIdSuffix: string;
	subagent?: SubagentHookContext;
}

export interface PostToolUseHookRequest extends HookRequestBase {
	eventName: "PostToolUse";
	turnId: string;
	tool: HookToolIdentity;
	toolUseId: string;
	toolInput: unknown;
	toolResponse: unknown;
	subagent?: SubagentHookContext;
}

export interface PostToolUseFailureHookRequest extends HookRequestBase {
	eventName: "PostToolUseFailure";
	turnId: string;
	tool: HookToolIdentity;
	toolUseId: string;
	toolInput: unknown;
	error: string;
	isInterrupt?: boolean;
	durationMs?: number;
	subagent?: SubagentHookContext;
}

export interface CompactHookRequest extends HookRequestBase {
	eventName: "PreCompact" | "PostCompact";
	turnId: string;
	trigger: CompactionTrigger;
	subagent?: SubagentHookContext;
}

export interface SubagentStartHookRequest extends HookRequestBase, SubagentHookContext {
	eventName: "SubagentStart";
	turnId: string;
}

export interface SubagentStopHookRequest extends HookRequestBase, SubagentHookContext {
	eventName: "SubagentStop";
	turnId: string;
	stopHookActive: boolean;
	lastAssistantMessage: string | null;
	agentTranscriptPath: string | null;
}

export interface StopHookRequest extends HookRequestBase {
	eventName: "Stop";
	turnId: string;
	stopHookActive: boolean;
	lastAssistantMessage: string | null;
}

export type HookRequest =
	| SessionStartHookRequest
	| SessionEndHookRequest
	| UserPromptSubmitHookRequest
	| PreToolUseHookRequest
	| PermissionRequestHookRequest
	| PostToolUseHookRequest
	| PostToolUseFailureHookRequest
	| CompactHookRequest
	| SubagentStartHookRequest
	| SubagentStopHookRequest
	| StopHookRequest;

export interface HookCommandExecutionRequest {
	command: string;
	cwd: string;
	stdin: string;
	timeoutMs: number;
	env?: Readonly<Record<string, string>>;
}

export interface HookCommandError {
	code: "spawn_failed" | "timed_out" | "cancelled" | "output_limit";
	message: string;
}

export interface HookCommandResult {
	startedAt: number;
	completedAt: number;
	durationMs: number;
	completionOrder?: number;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: HookCommandError;
}

export interface HookOutputEntry {
	kind: HookOutputEntryKind;
	text: string;
}

export interface HookRunSummary {
	id: string;
	profileId: string;
	eventName: HookEventName;
	handlerType: "command" | "callback";
	executionMode: "sync";
	scope: "session" | "turn";
	sourcePath: string;
	displayOrder: number;
	status: HookRunStatus;
	statusMessage?: string;
	startedAt: number;
	completedAt?: number;
	durationMs?: number;
	entries: HookOutputEntry[];
}

export interface HookHandlerOutcome {
	completionOrder?: number;
	status: Exclude<HookRunStatus, "Running">;
	entries: HookOutputEntry[];
	shouldStop: boolean;
	stopReason?: string;
	shouldBlock: boolean;
	blockReason?: string;
	additionalContexts: string[];
	feedbackMessages: string[];
	continuationFragments: string[];
	updatedToolInput?: unknown;
	permissionDecision?: "allow" | "deny";
	permissionMessage?: string;
}

export interface HookDispatchEffect {
	shouldStop: boolean;
	stopReason?: string;
	shouldBlock: boolean;
	blockReason?: string;
	additionalContexts: string[];
	feedbackMessage?: string;
	continuationFragments: string[];
	updatedToolInput?: unknown;
	permissionDecision?: "allow" | "deny";
	permissionMessage?: string;
}

export interface HookDispatchOutcome extends HookDispatchEffect {
	runs: HookRunSummary[];
}

export interface HookCompatibilityProfile {
	readonly id: string;
	encodeInput(request: HookRequest): string;
	interpretResult(request: HookRequest, result: HookCommandResult): HookHandlerOutcome;
	aggregate(request: HookRequest, outcomes: readonly HookHandlerOutcome[]): HookDispatchEffect;
	matches(request: HookRequest, matcher: string | undefined): boolean;
}

export interface HookCommandExecutor {
	execute(request: HookCommandExecutionRequest, signal?: AbortSignal): Promise<HookCommandResult>;
}

export interface HookObserver {
	onRunStarted?(summary: HookRunSummary): void;
	onRunCompleted?(summary: HookRunSummary): void;
}
