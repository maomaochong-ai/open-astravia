import type { Message } from "@vetta/ai";
import type { CodingAgentQuestionFunctionRequest } from "@vetta/coding-agent/function-extensions";
import type {
	RemoteDeviceStatus,
	RemoteDiagnosticsSnapshot,
	RemoteEventName,
	RemoteMessageEvent,
	RemoteProjectSummary,
	RemoteRequest,
	RemoteSessionState,
	RemoteSessionSummary,
	RemoteToolEvent,
	RemoteTranscriptEntry,
} from "@vetta/remote-control";
import type { HistoryEntry, SessionEvent, SessionStateSnapshot } from "@vetta/runtime-core";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import type {
	DesktopConversationService,
	DesktopConversationSession,
} from "../conversations/desktop-conversation-service.js";
import type { DesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { getAppLogger } from "../logger.js";
import { RemoteOperationError } from "./remote-error-mapping.js";
import {
	describe,
	keyForPath,
	lastUserTimestamp,
	modelLabel,
	preview,
	previousUserTimestamp,
	readQuestionResult,
	safeErrorMessage,
	textOf,
	toRemoteQuestion,
	toTranscript,
} from "./remote-transcript.js";

export interface RemoteMirrorRuntime {
	getState(sessionId: string): SessionStateSnapshot;
	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void;
	getMessages(sessionId: string): Message[];
	getFullHistory(sessionId: string): HistoryEntry[];
	readSessionHistoryFromFile(path: string): { history: HistoryEntry[] };
	getRunningSessionPaths(): string[];
	onRunningChanged(handler: (sessionPath: string, running: boolean, sessionId?: string) => void): () => void;
	getSessionPath(sessionId: string): string | undefined;
	abort(sessionId: string): Promise<void>;
}

export type RemoteMirrorConversations = Pick<
	DesktopConversationService,
	"listSessions" | "openSession" | "createSession" | "promptInteractiveSession"
>;

export type RemoteMirrorQuestions = Pick<
	DesktopUserQuestionBroker,
	"listPendingQuestions" | "answer" | "onQuestionAsked" | "onQuestionResolved"
>;

export interface RemoteMirrorProject {
	readonly cwd: string;
	readonly name: string;
}

export interface DesktopRemoteMirrorOptions {
	readonly runtime: RemoteMirrorRuntime;
	readonly conversations: RemoteMirrorConversations;
	readonly questions: RemoteMirrorQuestions;
	readonly listProjects: () => Promise<readonly RemoteMirrorProject[]>;
	readonly conversationCwd: string;
	readonly conversationLabel: string;
	readonly isConversationCwd: (cwd: string) => boolean;
	readonly emit: (name: RemoteEventName, payload?: unknown, sessionId?: string) => Promise<void>;
	readonly deviceStatus: () => RemoteDeviceStatus;
	readonly hardware?: () => { cpu?: string; ram?: string };
	/** Streamed text is batched at this interval so a long answer costs tens of frames, not thousands. */
	readonly coalesceMs?: number;
	readonly listRefreshMs?: number;
	readonly now?: () => number;
}

interface SessionHandle {
	readonly key: string;
	path: string;
	cwd: string;
	projectCwd: string;
	projectName: string;
	sessionId?: string;
}

interface TrackedSession {
	readonly handle: SessionHandle;
	sessionId: string;
	unsubscribe: () => void;
	assistantBuffer: string;
	thinkingBuffer: string;
	flushTimer?: ReturnType<typeof setTimeout>;
	/** Text already delivered for the current turn; `message.final` only sends the remainder. */
	observedText: string;
	/** Prompt text this mirror sent itself, so `agent_start` does not echo it a second time. */
	pendingUserText?: string;
	lastUserTimestamp: number;
	/** Keep tracking after the turn ends because a phone explicitly opened it. */
	pinned: boolean;
}

const log = getAppLogger("remote-mirror");
const MAX_LIST = 80;

/**
 * Presents the desktop's conversations to paired phones as a live mirror:
 * the same runtime sessions the desktop window shows, every project's
 * history, turns started from either side, and questions either side may
 * answer. It exists only while at least one phone is online; `stop()`
 * unhooks everything so an idle desktop pays nothing for it.
 */
export class DesktopRemoteMirror {
	private readonly handles = new Map<string, SessionHandle>();
	private readonly handlesByPath = new Map<string, SessionHandle>();
	private readonly tracked = new Map<string, TrackedSession>();
	private readonly unsubscribes: Array<() => void> = [];
	private listTimer: ReturnType<typeof setTimeout> | undefined;
	private summariesCache: { at: number; sessions: RemoteSessionSummary[] } | undefined;
	private readonly coalesceMs: number;
	private readonly listRefreshMs: number;
	private readonly now: () => number;
	private started = false;

	constructor(private readonly options: DesktopRemoteMirrorOptions) {
		this.coalesceMs = options.coalesceMs ?? 80;
		this.listRefreshMs = options.listRefreshMs ?? 750;
		this.now = options.now ?? Date.now;
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.unsubscribes.push(
			this.options.runtime.onRunningChanged((sessionPath, running, sessionId) => {
				void this.handleRunningChanged(sessionPath, running, sessionId);
			}),
			this.options.questions.onQuestionAsked((request) => void this.handleQuestionAsked(request)),
			this.options.questions.onQuestionResolved(({ requestId, sessionId }) => {
				void this.handleQuestionResolved(requestId, sessionId);
			}),
		);
		// Turns already in flight when the first phone arrives must be visible
		// too: open them (the runtime dedupes by path) and subscribe.
		for (const path of this.options.runtime.getRunningSessionPaths()) {
			try {
				const handle = await this.handleForPath(path);
				if (handle) await this.ensureOpen(handle, false);
			} catch (error) {
				log.debug("remote mirror could not attach to a running session", { error: describe(error) });
			}
		}
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
		for (const tracked of this.tracked.values()) this.untrack(tracked, false);
		this.tracked.clear();
		if (this.listTimer) clearTimeout(this.listTimer);
		this.listTimer = undefined;
		this.summariesCache = undefined;
	}

	async handleRequest(request: RemoteRequest): Promise<unknown> {
		switch (request.method) {
			case "project.list":
				return { projects: await this.listProjects() };
			case "session.list": {
				const payload = asRecord(request.payload);
				const projectCwd = typeof payload.projectCwd === "string" ? payload.projectCwd : undefined;
				const limit = typeof payload.limit === "number" ? Math.max(1, Math.min(MAX_LIST, payload.limit)) : MAX_LIST;
				const sessions = await this.listSessions();
				return { sessions: sessions.filter((s) => !projectCwd || s.projectCwd === projectCwd).slice(0, limit) };
			}
			case "session.create": {
				const payload = asRecord(request.payload);
				const projectCwd =
					typeof payload.projectCwd === "string" && payload.projectCwd ? payload.projectCwd : undefined;
				return { session: await this.createSession(projectCwd) };
			}
			case "session.open": {
				const handle = this.requireHandle(request.sessionId);
				await this.ensureOpen(handle, true);
				return { session: await this.summaryFor(handle), state: this.stateFor(handle) };
			}
			case "session.history": {
				const handle = this.requireHandle(request.sessionId);
				return { entries: this.historyFor(handle), state: this.stateFor(handle) };
			}
			case "session.prompt": {
				const handle = this.requireHandle(request.sessionId);
				const payload = asRecord(request.payload);
				const text = typeof payload.text === "string" ? payload.text : "";
				if (!text.trim()) throw new RemoteOperationError("invalid_frame", "prompt text is required");
				await this.prompt(handle, text);
				return { accepted: true };
			}
			case "session.respond": {
				this.requireHandle(request.sessionId);
				const payload = asRecord(request.payload);
				const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
				if (!requestId) throw new RemoteOperationError("invalid_frame", "question requestId is required");
				const result = readQuestionResult(payload);
				if (!this.options.questions.answer(requestId, result)) {
					throw new RemoteOperationError("not_found", "Question request is no longer pending");
				}
				return { responded: true };
			}
			case "session.abort": {
				const handle = this.requireHandle(request.sessionId);
				if (handle.sessionId) await this.options.runtime.abort(handle.sessionId);
				return { aborted: true };
			}
			case "session.resume":
				return { resumed: true };
			case "diagnostics.snapshot":
				return this.diagnostics();
		}
	}

	diagnostics(): RemoteDiagnosticsSnapshot {
		return {
			...this.options.deviceStatus(),
			liveSessionCount: this.tracked.size,
			...(this.options.hardware?.() ?? {}),
		};
	}

	// ---- catalog ----

	private async listProjects(): Promise<RemoteProjectSummary[]> {
		const projects = await this.options.listProjects();
		const sessions = await this.listSessions();
		const count = (cwd: string): number => sessions.filter((session) => session.projectCwd === cwd).length;
		return [
			{
				cwd: this.options.conversationCwd,
				name: this.options.conversationLabel,
				kind: "conversation",
				sessionCount: count(this.options.conversationCwd),
			},
			...projects.map((project) => ({
				cwd: project.cwd,
				name: project.name,
				kind: "project" as const,
				sessionCount: count(project.cwd),
			})),
		];
	}

	private async listSessions(): Promise<RemoteSessionSummary[]> {
		const cached = this.summariesCache;
		if (cached && this.now() - cached.at < 1_500) return cached.sessions;
		const projects = await this.options.listProjects();
		const roots: RemoteMirrorProject[] = [
			{ cwd: this.options.conversationCwd, name: this.options.conversationLabel },
			...projects,
		];
		const running = new Set(this.options.runtime.getRunningSessionPaths());
		const waiting = this.pendingQuestionPaths();
		const summaries: RemoteSessionSummary[] = [];
		for (const root of roots) {
			let entries: DesktopSessionHistoryInfo[];
			try {
				entries = await this.options.conversations.listSessions(root.cwd);
			} catch (error) {
				log.debug("remote mirror could not list a project", { error: describe(error) });
				continue;
			}
			for (const entry of entries) {
				if (!entry.access.readHistory) continue;
				const handle = this.registerHandle(entry.path, entry.cwd, root);
				summaries.push(this.summarize(handle, entry, running, waiting));
			}
		}
		summaries.sort((a, b) => b.updatedAt - a.updatedAt);
		const sessions = summaries.slice(0, MAX_LIST);
		this.summariesCache = { at: this.now(), sessions };
		return sessions;
	}

	private summarize(
		handle: SessionHandle,
		entry: DesktopSessionHistoryInfo,
		running: Set<string>,
		waiting: Set<string>,
	): RemoteSessionSummary {
		const tracked = handle.sessionId ? this.tracked.get(handle.sessionId) : undefined;
		return {
			id: handle.key,
			projectCwd: handle.projectCwd,
			projectName: handle.projectName,
			title: (entry.name ?? entry.firstMessage ?? "").trim(),
			preview: entry.lastMessagePreview,
			updatedAt: entry.modifiedAt,
			status: waiting.has(handle.path) ? "waiting_input" : running.has(handle.path) ? "running" : "idle",
			live: tracked !== undefined || running.has(handle.path),
		};
	}

	private async summaryFor(handle: SessionHandle): Promise<RemoteSessionSummary> {
		this.summariesCache = undefined;
		const sessions = await this.listSessions();
		const found = sessions.find((session) => session.id === handle.key);
		if (found) return found;
		const state = this.stateFor(handle);
		return {
			id: handle.key,
			projectCwd: handle.projectCwd,
			projectName: handle.projectName,
			title: "",
			updatedAt: this.now(),
			status: state.status,
			live: handle.sessionId !== undefined,
		};
	}

	private registerHandle(path: string, cwd: string, root: RemoteMirrorProject): SessionHandle {
		const existing = this.handlesByPath.get(path);
		if (existing) {
			existing.cwd = cwd;
			existing.projectCwd = root.cwd;
			existing.projectName = root.name;
			return existing;
		}
		const handle: SessionHandle = {
			key: keyForPath(path),
			path,
			cwd,
			projectCwd: root.cwd,
			projectName: root.name,
		};
		this.handles.set(handle.key, handle);
		this.handlesByPath.set(path, handle);
		return handle;
	}

	private async handleForPath(path: string): Promise<SessionHandle | undefined> {
		const known = this.handlesByPath.get(path);
		if (known) return known;
		this.summariesCache = undefined;
		await this.listSessions();
		return this.handlesByPath.get(path);
	}

	private requireHandle(key: string | undefined): SessionHandle {
		const handle = key ? this.handles.get(key) : undefined;
		if (!handle) throw new RemoteOperationError("not_found", "Desktop session was not found");
		return handle;
	}

	// ---- live sessions ----

	private async createSession(projectCwd: string | undefined): Promise<RemoteSessionSummary> {
		const cwd = projectCwd ?? this.options.conversationCwd;
		const projects = await this.options.listProjects();
		const root =
			cwd === this.options.conversationCwd || this.options.isConversationCwd(cwd)
				? { cwd: this.options.conversationCwd, name: this.options.conversationLabel }
				: projects.find((project) => project.cwd === cwd);
		if (!root) throw new RemoteOperationError("not_found", "Project is not open on the desktop");
		const session = await this.options.conversations.createSession(
			{ cwd },
			root.cwd === this.options.conversationCwd ? "conversation" : "other",
			"interactive",
		);
		const handle = this.registerHandle(session.sessionPath, session.cwd, root);
		this.adopt(handle, session, true);
		this.scheduleListRefresh();
		return await this.summaryFor(handle);
	}

	private async ensureOpen(handle: SessionHandle, pinned: boolean): Promise<TrackedSession> {
		const current = handle.sessionId ? this.tracked.get(handle.sessionId) : undefined;
		if (current) {
			if (pinned) current.pinned = true;
			return current;
		}
		const session = await this.options.conversations.openSession(handle.path, undefined, "interactive");
		return this.adopt(handle, session, pinned);
	}

	private adopt(handle: SessionHandle, session: DesktopConversationSession, pinned: boolean): TrackedSession {
		handle.sessionId = session.sessionId;
		const existing = this.tracked.get(session.sessionId);
		if (existing) {
			if (pinned) existing.pinned = true;
			return existing;
		}
		const tracked: TrackedSession = {
			handle,
			sessionId: session.sessionId,
			unsubscribe: () => undefined,
			assistantBuffer: "",
			thinkingBuffer: "",
			observedText: "",
			lastUserTimestamp: lastUserTimestamp(this.options.runtime.getMessages(session.sessionId)),
			pinned,
		};
		tracked.unsubscribe = this.options.runtime.subscribe(session.sessionId, (event) =>
			this.handleRuntimeEvent(tracked, event),
		);
		this.tracked.set(session.sessionId, tracked);
		return tracked;
	}

	private untrack(tracked: TrackedSession, forget: boolean): void {
		if (tracked.flushTimer) clearTimeout(tracked.flushTimer);
		tracked.flushTimer = undefined;
		tracked.unsubscribe();
		if (forget) this.tracked.delete(tracked.sessionId);
	}

	private async prompt(handle: SessionHandle, text: string): Promise<void> {
		const tracked = await this.ensureOpen(handle, true);
		if (this.options.runtime.getState(tracked.sessionId).isStreaming) {
			throw new RemoteOperationError("busy", "Desktop session is already processing a turn", true);
		}
		tracked.pendingUserText = text;
		const at = this.now();
		await this.emitMessage(handle.key, { kind: "user", text, at });
		await this.emitState(handle.key, { status: "running" });
		void this.options.conversations
			.promptInteractiveSession(tracked.sessionId, { text }, handle.cwd)
			.catch(async (error: unknown) => {
				log.warn("remote prompt failed", { error: describe(error) });
				await this.emitState(handle.key, {
					status: "error",
					error: { code: "turn_failed", message: safeErrorMessage(error) },
				});
			});
	}

	private async handleRunningChanged(sessionPath: string, running: boolean, sessionId?: string): Promise<void> {
		if (!this.started) return;
		this.scheduleListRefresh();
		if (!running) {
			const tracked = sessionId ? this.tracked.get(sessionId) : undefined;
			if (tracked && !tracked.pinned) this.untrack(tracked, true);
			return;
		}
		try {
			const handle = await this.handleForPath(sessionPath);
			if (!handle) return;
			if (sessionId && !this.tracked.has(sessionId)) {
				handle.sessionId = sessionId;
				const tracked = this.adopt(
					handle,
					{ sessionId, sessionPath, cwd: handle.cwd, listCwd: handle.projectCwd, source: "interactive" },
					false,
				);
				// "Running" is reported once the turn has begun, so the user's message
				// is already in history and `agent_start` may have fired before we
				// subscribed. Announce the turn now instead of waiting for it.
				tracked.lastUserTimestamp = previousUserTimestamp(this.options.runtime.getMessages(sessionId));
				this.emitDesktopUserMessage(tracked);
				void this.emitState(handle.key, { status: "running", model: this.modelFor(sessionId) });
			} else if (!sessionId) {
				await this.ensureOpen(handle, false);
			}
		} catch (error) {
			log.debug("remote mirror could not follow a running session", { error: describe(error) });
		}
	}

	private handleRuntimeEvent(tracked: TrackedSession, event: SessionEvent): void {
		const key = tracked.handle.key;
		if (event.channel === "assistant") {
			if (event.type === "text_delta") {
				this.bufferDelta(tracked, "assistant", event.delta);
				return;
			}
			if (event.type === "thinking_delta") {
				this.bufferDelta(tracked, "thinking", event.delta);
				return;
			}
			if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
				const call = event.partial.content[event.contentIndex];
				if (call?.type !== "toolCall") return;
				this.flush(tracked);
				void this.emitTool(key, {
					toolCallId: call.id,
					toolName: call.name,
					phase: "generating",
					...(event.type === "toolcall_start" ? {} : { args: preview(call.arguments) }),
				});
				return;
			}
			if (event.type === "done" || event.type === "error") {
				const message = event.type === "done" ? event.message : event.error;
				const text = textOf(message.content);
				const missing =
					tracked.observedText && text.startsWith(tracked.observedText)
						? text.slice(tracked.observedText.length)
						: text;
				if (missing) this.bufferDelta(tracked, "assistant", missing);
				this.flush(tracked);
			}
			return;
		}
		switch (event.type) {
			case "message.delta":
				this.bufferDelta(tracked, "assistant", event.delta);
				return;
			case "thinking.delta":
				this.bufferDelta(tracked, "thinking", event.delta);
				return;
			case "message.final": {
				if (event.message.role !== "assistant") return;
				const text = textOf(event.message.content);
				const missing =
					tracked.observedText && text.startsWith(tracked.observedText)
						? text.slice(tracked.observedText.length)
						: text;
				if (missing) this.bufferDelta(tracked, "assistant", missing);
				this.flush(tracked);
				return;
			}
			case "toolcall.start":
				this.flush(tracked);
				void this.emitTool(key, { toolCallId: event.toolCallId, toolName: event.toolName, phase: "generating" });
				return;
			case "toolcall.args":
				this.flush(tracked);
				void this.emitTool(key, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					phase: "generating",
					args: preview(event.args),
				});
				return;
			case "tool.start":
				this.flush(tracked);
				void this.emitTool(key, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					phase: "started",
					args: preview(event.args),
				});
				return;
			case "tool.update":
				void this.emitTool(key, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					phase: "updated",
					result: preview(event.partialResult),
				});
				return;
			case "tool.phase":
				void this.emitTool(key, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					phase: "phase",
					label: event.label,
				});
				return;
			case "tool.end":
				this.flush(tracked);
				void this.emitTool(key, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					phase: event.isError ? "failed" : "completed",
					result: preview(event.result),
					durationMs: event.durationMs,
				});
				return;
			case "retry.start":
				void this.emitState(key, { status: "running", detail: `retry ${event.attempt}/${event.maxAttempts}` });
				return;
			case "retry.end":
			case "compaction.end":
				void this.emitState(key, { status: "running" });
				return;
			case "compaction.start":
				this.flush(tracked);
				void this.emitState(key, { status: "running", detail: "compacting" });
				return;
			case "usage.update":
				if (typeof event.contextPercent === "number") {
					void this.emitState(key, { status: "running", contextPercent: event.contextPercent });
				}
				return;
			case "error":
				this.flush(tracked);
				void this.emitState(key, {
					status: "error",
					error: { code: String(event.error.code ?? "turn_failed"), message: safeErrorMessage(event.error) },
				});
				return;
			case "session.lifecycle":
				this.handleLifecycle(tracked, event.phase);
				return;
			case "session.path_changed":
				if (event.path && event.path !== tracked.handle.path) {
					this.handlesByPath.delete(tracked.handle.path);
					tracked.handle.path = event.path;
					this.handlesByPath.set(event.path, tracked.handle);
				}
				return;
			default:
				return;
		}
	}

	private handleLifecycle(tracked: TrackedSession, phase: string): void {
		const key = tracked.handle.key;
		switch (phase) {
			case "agent_start": {
				tracked.observedText = "";
				this.emitDesktopUserMessage(tracked);
				void this.emitState(key, { status: "running", model: this.modelFor(tracked.sessionId) });
				return;
			}
			case "turn_start":
				tracked.observedText = "";
				return;
			case "turn_end":
				this.flush(tracked);
				return;
			case "agent_end": {
				this.flush(tracked);
				void this.emitMessage(key, { kind: "turn_end", at: this.now() });
				void this.emitState(key, { status: "completed" });
				this.scheduleListRefresh();
				return;
			}
			case "aborted":
				this.flush(tracked);
				void this.emitMessage(key, { kind: "turn_end", at: this.now() });
				void this.emitState(key, { status: "aborted" });
				return;
			default:
				return;
		}
	}

	/** A turn started on the desktop carries a user message the phone never saw; replay it from history. */
	private emitDesktopUserMessage(tracked: TrackedSession): void {
		const messages = this.options.runtime.getMessages(tracked.sessionId);
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message?.role !== "user") continue;
			if (message.timestamp <= tracked.lastUserTimestamp) return;
			tracked.lastUserTimestamp = message.timestamp;
			const text = textOf(message.content);
			if (tracked.pendingUserText !== undefined && tracked.pendingUserText === text) {
				tracked.pendingUserText = undefined;
				return;
			}
			tracked.pendingUserText = undefined;
			void this.emitMessage(tracked.handle.key, { kind: "user", text, at: message.timestamp });
			return;
		}
	}

	private bufferDelta(tracked: TrackedSession, channel: "assistant" | "thinking", delta: string): void {
		if (!delta) return;
		if (channel === "assistant") {
			tracked.assistantBuffer += delta;
			tracked.observedText += delta;
		} else tracked.thinkingBuffer += delta;
		if (tracked.flushTimer) return;
		tracked.flushTimer = setTimeout(() => {
			tracked.flushTimer = undefined;
			this.flush(tracked);
		}, this.coalesceMs);
	}

	private flush(tracked: TrackedSession): void {
		if (tracked.flushTimer) {
			clearTimeout(tracked.flushTimer);
			tracked.flushTimer = undefined;
		}
		const key = tracked.handle.key;
		if (tracked.thinkingBuffer) {
			const text = tracked.thinkingBuffer;
			tracked.thinkingBuffer = "";
			void this.emitMessage(key, { kind: "thinking_delta", text });
		}
		if (tracked.assistantBuffer) {
			const text = tracked.assistantBuffer;
			tracked.assistantBuffer = "";
			void this.emitMessage(key, { kind: "assistant_delta", text });
		}
	}

	private scheduleListRefresh(): void {
		if (!this.started || this.listTimer) return;
		this.listTimer = setTimeout(() => {
			this.listTimer = undefined;
			this.summariesCache = undefined;
			void this.listSessions()
				.then((sessions) => this.options.emit("session.list", { sessions }))
				.catch((error: unknown) => log.debug("remote list refresh failed", { error: describe(error) }));
		}, this.listRefreshMs);
		this.listTimer.unref?.();
	}

	// ---- questions ----

	private async handleQuestionAsked(request: CodingAgentQuestionFunctionRequest): Promise<void> {
		const handle = await this.handleForSessionId(request.sessionId);
		if (!handle) return;
		const question = toRemoteQuestion(request);
		await this.options.emit("session.input", { kind: "question", request: question }, handle.key);
		await this.emitState(handle.key, { status: "waiting_input", pendingQuestion: question });
	}

	private async handleQuestionResolved(requestId: string, sessionId: string): Promise<void> {
		const handle = await this.handleForSessionId(sessionId);
		if (!handle) return;
		await this.options.emit("session.input", { kind: "resolved", requestId }, handle.key);
		const streaming = handle.sessionId ? this.options.runtime.getState(handle.sessionId).isStreaming : false;
		await this.emitState(handle.key, { status: streaming ? "running" : "idle" });
	}

	private async handleForSessionId(sessionId: string): Promise<SessionHandle | undefined> {
		const tracked = this.tracked.get(sessionId);
		if (tracked) return tracked.handle;
		const path = this.options.runtime.getSessionPath(sessionId);
		if (!path) return undefined;
		const handle = await this.handleForPath(path);
		if (handle) handle.sessionId = sessionId;
		return handle;
	}

	private pendingQuestionPaths(): Set<string> {
		const paths = new Set<string>();
		for (const request of this.options.questions.listPendingQuestions()) {
			const path = this.options.runtime.getSessionPath(request.sessionId);
			if (path) paths.add(path);
		}
		return paths;
	}

	// ---- state & history ----

	private stateFor(handle: SessionHandle): RemoteSessionState {
		const pending = this.options.questions
			.listPendingQuestions()
			.find((request) => request.sessionId === handle.sessionId);
		if (pending)
			return {
				status: "waiting_input",
				pendingQuestion: toRemoteQuestion(pending),
				model: this.modelFor(handle.sessionId),
			};
		if (!handle.sessionId) {
			return { status: this.options.runtime.getRunningSessionPaths().includes(handle.path) ? "running" : "idle" };
		}
		let snapshot: SessionStateSnapshot | undefined;
		try {
			snapshot = this.options.runtime.getState(handle.sessionId);
		} catch {
			snapshot = undefined;
		}
		return {
			status: snapshot?.isStreaming ? "running" : "idle",
			model: modelLabel(snapshot?.model),
			contextPercent: snapshot?.contextPercent ?? undefined,
		};
	}

	private modelFor(sessionId: string | undefined): string | undefined {
		if (!sessionId) return undefined;
		try {
			return modelLabel(this.options.runtime.getState(sessionId).model);
		} catch {
			return undefined;
		}
	}

	private historyFor(handle: SessionHandle): RemoteTranscriptEntry[] {
		let history: HistoryEntry[];
		try {
			history = handle.sessionId
				? this.options.runtime.getFullHistory(handle.sessionId)
				: this.options.runtime.readSessionHistoryFromFile(handle.path).history;
		} catch (error) {
			log.debug("remote history read failed", { error: describe(error) });
			history = this.options.runtime.readSessionHistoryFromFile(handle.path).history;
		}
		return toTranscript(history);
	}

	private async emitMessage(key: string, payload: RemoteMessageEvent): Promise<void> {
		await this.options.emit("session.message", payload, key);
	}

	private async emitTool(key: string, payload: RemoteToolEvent): Promise<void> {
		await this.options.emit("session.tool", payload, key);
	}

	private async emitState(key: string, payload: RemoteSessionState): Promise<void> {
		await this.options.emit("session.state", payload, key);
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
