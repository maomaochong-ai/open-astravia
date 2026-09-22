import type {
	RemoteMessageEvent,
	RemoteQuestionRequest,
	RemoteSessionState,
	RemoteToolCallSummary,
	RemoteToolEvent,
	RemoteTranscriptEntry,
} from "@vetta/remote-control";

export type ToolCardStatus = "generating" | "running" | "done" | "failed";

export interface ToolCard {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly status: ToolCardStatus;
	readonly args?: string;
	readonly result?: string;
	readonly label?: string;
	readonly durationMs?: number;
}

export type TranscriptItem =
	| { readonly kind: "user"; readonly id: string; readonly text: string; readonly at?: number }
	| {
			readonly kind: "assistant";
			readonly id: string;
			readonly text: string;
			readonly thinking: string;
			readonly tools: readonly ToolCard[];
			readonly streaming: boolean;
			readonly at?: number;
			readonly error?: string;
	  }
	| { readonly kind: "marker"; readonly id: string; readonly text: string; readonly at?: number };

export interface TranscriptState {
	readonly items: readonly TranscriptItem[];
	readonly sessionState: RemoteSessionState;
	readonly pendingQuestion?: RemoteQuestionRequest;
	/** Set after `session.resync`; the owner must refetch history before trusting `items`. */
	readonly stale: boolean;
	readonly loaded: boolean;
}

export type TranscriptAction =
	| {
			readonly type: "history";
			readonly entries: readonly RemoteTranscriptEntry[];
			readonly state: RemoteSessionState;
	  }
	| { readonly type: "message"; readonly event: RemoteMessageEvent }
	| { readonly type: "tool"; readonly event: RemoteToolEvent }
	| { readonly type: "state"; readonly state: RemoteSessionState }
	| { readonly type: "question"; readonly request: RemoteQuestionRequest }
	| { readonly type: "question-resolved"; readonly requestId: string }
	| { readonly type: "local-user"; readonly text: string; readonly at: number }
	| { readonly type: "resync" };

export const emptyTranscript: TranscriptState = {
	items: [],
	sessionState: { status: "idle" },
	stale: false,
	loaded: false,
};

let localCounter = 0;
function nextLocalId(prefix: string): string {
	localCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${localCounter}`;
}

const activeStatuses = new Set(["running", "thinking", "waiting_input"]);

export function isActiveStatus(status: RemoteSessionState["status"]): boolean {
	return activeStatuses.has(status);
}

/** Pure reducer: history snapshot plus live events → chat view model. */
export function reduceTranscript(state: TranscriptState, action: TranscriptAction): TranscriptState {
	switch (action.type) {
		case "history":
			return {
				items: action.entries.map(fromHistoryEntry),
				sessionState: action.state,
				pendingQuestion: action.state.pendingQuestion,
				stale: false,
				loaded: true,
			};
		case "local-user":
			return {
				...state,
				items: [...state.items, { kind: "user", id: nextLocalId("local-user"), text: action.text, at: action.at }],
			};
		case "message":
			return applyMessage(state, action.event);
		case "tool":
			return applyTool(state, action.event);
		case "state": {
			const finished = !isActiveStatus(action.state.status);
			return {
				...state,
				sessionState: action.state,
				pendingQuestion:
					action.state.pendingQuestion ??
					(action.state.status === "waiting_input" ? state.pendingQuestion : undefined),
				items: finished ? finalizeStreaming(state.items, action.state) : state.items,
			};
		}
		case "question":
			return {
				...state,
				pendingQuestion: action.request,
				sessionState: { ...state.sessionState, status: "waiting_input", pendingQuestion: action.request },
			};
		case "question-resolved":
			if (state.pendingQuestion?.requestId !== action.requestId) return state;
			return {
				...state,
				pendingQuestion: undefined,
				sessionState: { ...state.sessionState, status: "running", pendingQuestion: undefined },
			};
		case "resync":
			return { ...emptyTranscript, sessionState: state.sessionState, stale: true };
	}
}

function fromHistoryEntry(entry: RemoteTranscriptEntry): TranscriptItem {
	switch (entry.kind) {
		case "user":
			return { kind: "user", id: entry.id, text: entry.text, at: entry.at };
		case "assistant":
			return {
				kind: "assistant",
				id: entry.id,
				text: entry.text,
				thinking: entry.thinking ?? "",
				tools: entry.toolCalls.map(fromToolSummary),
				streaming: false,
				at: entry.at,
				error: entry.error,
			};
		case "marker":
			return { kind: "marker", id: entry.id, text: entry.text, at: entry.at };
	}
}

function fromToolSummary(call: RemoteToolCallSummary): ToolCard {
	return {
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		status: call.isError ? "failed" : "done",
		args: call.args,
		result: call.result,
		durationMs: call.durationMs,
	};
}

function applyMessage(state: TranscriptState, event: RemoteMessageEvent): TranscriptState {
	switch (event.kind) {
		case "user": {
			// A user bubble we optimistically added for our own prompt is replaced
			// by the desktop's authoritative copy instead of being duplicated.
			const items = dropMatchingLocalUser(state.items, event.text);
			return {
				...state,
				items: [...items, { kind: "user", id: nextLocalId("user"), text: event.text, at: event.at }],
			};
		}
		case "assistant_delta":
			return updateStreaming(state, (item) => ({ ...item, text: item.text + event.text }));
		case "thinking_delta":
			return updateStreaming(state, (item) => ({ ...item, thinking: item.thinking + event.text }));
		case "turn_end":
			return { ...state, items: finalizeStreaming(state.items, state.sessionState) };
	}
}

function applyTool(state: TranscriptState, event: RemoteToolEvent): TranscriptState {
	return updateStreaming(state, (item) => {
		const existing = item.tools.find((tool) => tool.toolCallId === event.toolCallId);
		const merged: ToolCard = {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: statusForPhase(event.phase, existing?.status),
			args: event.args ?? existing?.args,
			result: event.result ?? existing?.result,
			label: event.label ?? existing?.label,
			durationMs: event.durationMs ?? existing?.durationMs,
		};
		const tools = existing
			? item.tools.map((tool) => (tool.toolCallId === event.toolCallId ? merged : tool))
			: [...item.tools, merged];
		return { ...item, tools };
	});
}

function statusForPhase(phase: RemoteToolEvent["phase"], previous: ToolCardStatus | undefined): ToolCardStatus {
	switch (phase) {
		case "generating":
			return previous ?? "generating";
		case "started":
		case "updated":
		case "phase":
			return previous === "done" || previous === "failed" ? previous : "running";
		case "completed":
			return "done";
		case "failed":
			return "failed";
	}
}

type AssistantItem = Extract<TranscriptItem, { kind: "assistant" }>;

function updateStreaming(state: TranscriptState, patch: (item: AssistantItem) => AssistantItem): TranscriptState {
	const last = state.items[state.items.length - 1];
	if (last?.kind === "assistant" && last.streaming) {
		return { ...state, items: [...state.items.slice(0, -1), patch(last)] };
	}
	const fresh: AssistantItem = {
		kind: "assistant",
		id: nextLocalId("assistant"),
		text: "",
		thinking: "",
		tools: [],
		streaming: true,
		at: Date.now(),
	};
	return { ...state, items: [...state.items, patch(fresh)] };
}

function finalizeStreaming(
	items: readonly TranscriptItem[],
	sessionState: RemoteSessionState,
): readonly TranscriptItem[] {
	const last = items[items.length - 1];
	if (last?.kind !== "assistant" || !last.streaming) return items;
	const error = sessionState.status === "error" ? sessionState.error?.message : undefined;
	const tools = last.tools.map((tool) =>
		tool.status === "running" || tool.status === "generating"
			? { ...tool, status: sessionState.status === "error" ? ("failed" as const) : ("done" as const) }
			: tool,
	);
	const finalized: AssistantItem = { ...last, streaming: false, tools, error: error ?? last.error };
	if (!finalized.text && !finalized.thinking && finalized.tools.length === 0 && !finalized.error) {
		return items.slice(0, -1);
	}
	return [...items.slice(0, -1), finalized];
}

function dropMatchingLocalUser(items: readonly TranscriptItem[], text: string): readonly TranscriptItem[] {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index]!;
		if (item.kind === "assistant") continue;
		if (item.kind === "user" && item.id.startsWith("local-user") && item.text === text) {
			return [...items.slice(0, index), ...items.slice(index + 1)];
		}
		break;
	}
	return items;
}
