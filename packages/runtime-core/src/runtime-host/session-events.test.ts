import type { AgentSession, AgentSessionEvent } from "@vetta/coding-agent";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../contracts.js";
import { flushPendingError, type MapAgentEventState, mapAgentSessionEvent } from "./session-events.js";

const SESSION_ID = "s1";

function makeState(): MapAgentEventState {
	return { currentTurnStartedAt: new Map(), pendingError: new Map() };
}

/** 只实现 mapAgentSessionEvent 会碰到的两个面：上下文用量与 turn timing 落盘。 */
function makeSession(): AgentSession {
	return {
		getContextUsage: () => ({ percent: 10, contextWindow: 200_000 }),
		sessionManager: { appendCustomEntry: () => {} },
	} as unknown as AgentSession;
}

function assistantMessageEnd(stopReason: "stop" | "error" | "aborted", errorMessage?: string): AgentSessionEvent {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: [],
			stopReason,
			errorMessage,
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		},
	} as unknown as AgentSessionEvent;
}

function retryStart(attempt: number, errorMessage: string): AgentSessionEvent {
	return { type: "auto_retry_start", attempt, maxAttempts: 3, delayMs: 1000, errorMessage } as AgentSessionEvent;
}

function retryEnd(success: boolean, attempt: number, finalError?: string): AgentSessionEvent {
	return { type: "auto_retry_end", success, attempt, finalError } as AgentSessionEvent;
}

/** 依次喂入事件，返回所有映射出的宿主事件。 */
function feed(state: MapAgentEventState, events: AgentSessionEvent[]): SessionEvent[] {
	const session = makeSession();
	return events.flatMap((e) => mapAgentSessionEvent(SESSION_ID, e, session, state));
}

describe("错误延迟发射状态机", () => {
	it("没有重试时：flush 后恰好一条 error，且不带重试次数", () => {
		const state = makeState();
		const mapped = feed(state, [assistantMessageEnd("error", "400 invalid request")]);

		expect(mapped.filter((e) => e.type === "error")).toHaveLength(0);

		const flushed = flushPendingError(SESSION_ID, state);
		expect(flushed).not.toBeNull();
		expect(flushed?.type).toBe("error");
		if (flushed?.type !== "error") throw new Error("unreachable");
		expect(flushed.error.message).toBe("400 invalid request");
		expect(flushed.retryAttempts).toBe(0);
	});

	it("重试期间只发 retry 事件，不发 error", () => {
		const state = makeState();
		const mapped = feed(state, [
			assistantMessageEnd("error", "429 rate limit"),
			retryStart(1, "429 rate limit"),
			assistantMessageEnd("error", "429 rate limit"),
			retryStart(2, "429 rate limit"),
		]);

		expect(mapped.filter((e) => e.type === "error")).toHaveLength(0);
		expect(mapped.filter((e) => e.type === "retry.start")).toHaveLength(2);
	});

	it("重试耗尽：flush 出唯一一条 error，并带上实际重试次数", () => {
		const state = makeState();
		const mapped = feed(state, [
			assistantMessageEnd("error", "429 rate limit"),
			retryStart(1, "429 rate limit"),
			assistantMessageEnd("error", "429 rate limit"),
			retryStart(2, "429 rate limit"),
			assistantMessageEnd("error", "429 rate limit"),
			retryEnd(false, 3, "429 rate limit"),
		]);

		expect(mapped.filter((e) => e.type === "error")).toHaveLength(0);
		const end = mapped.find((e) => e.type === "retry.end");
		expect(end).toBeDefined();

		const flushed = flushPendingError(SESSION_ID, state);
		if (flushed?.type !== "error") throw new Error("expected an error event");
		expect(flushed.retryAttempts).toBe(2);
		// flush 是一次性的：第二次调用不会再吐同一条错误。
		expect(flushPendingError(SESSION_ID, state)).toBeNull();
	});

	it("重试成功：挂起的错误作废，flush 什么都不出", () => {
		const state = makeState();
		feed(state, [
			assistantMessageEnd("error", "500 server error"),
			retryStart(1, "500 server error"),
			retryEnd(true, 1),
		]);

		expect(flushPendingError(SESSION_ID, state)).toBeNull();
	});

	it("回合后续成功（如压缩后重跑）：挂起的错误作废", () => {
		const state = makeState();
		feed(state, [assistantMessageEnd("error", "context overflow"), assistantMessageEnd("stop")]);

		expect(flushPendingError(SESSION_ID, state)).toBeNull();
	});

	it("用户中止：不再把重试期攒下的错误弹给用户", () => {
		const state = makeState();
		const mapped = feed(state, [
			assistantMessageEnd("error", "429 rate limit"),
			retryStart(1, "429 rate limit"),
			assistantMessageEnd("aborted"),
		]);

		expect(mapped.some((e) => e.type === "session.lifecycle" && e.phase === "aborted")).toBe(true);
		expect(flushPendingError(SESSION_ID, state)).toBeNull();
	});

	it("会话之间互不串扰", () => {
		const state = makeState();
		const session = makeSession();
		mapAgentSessionEvent("a", assistantMessageEnd("error", "err-a"), session, state);
		mapAgentSessionEvent("b", assistantMessageEnd("error", "err-b"), session, state);

		const a = flushPendingError("a", state);
		const b = flushPendingError("b", state);
		if (a?.type !== "error" || b?.type !== "error") throw new Error("expected two error events");
		expect(a.error.message).toBe("err-a");
		expect(b.error.message).toBe("err-b");
	});
});
