import type { UserMessage } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import {
	createAgentSession,
	type SessionContextRecord,
	type StoredConversation,
	type TurnPipeline,
	type TurnResult,
} from "../../src/kernel/index.js";

describe("AgentSession asynchronous continuation", () => {
	it("wakes an idle session without adding a user input", async () => {
		const fixture = createFixture();
		const session = await createAgentSession({ id: "session-idle", pipeline: fixture.pipeline });

		const context = [contextRecord("background result")];
		await session.requestContinuation(context);

		expect(fixture.continueTurn).toHaveBeenCalledOnce();
		expect(fixture.continueTurn).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(AbortSignal),
			expect.anything(),
			context,
		);
		expect(fixture.runTurn).not.toHaveBeenCalled();
	});

	it("waits for an active turn and coalesces notifications into one continuation", async () => {
		const fixture = createFixture({ blockRun: true });
		const session = await createAgentSession({ id: "session-running", pipeline: fixture.pipeline });
		const activeTurn = session.send({ message: userMessage("working") });
		await vi.waitFor(() => expect(fixture.runTurn).toHaveBeenCalledOnce());

		const first = session.requestContinuation([contextRecord("first")]);
		const second = session.requestContinuation([contextRecord("second")]);
		expect(fixture.continueTurn).not.toHaveBeenCalled();

		fixture.completeRun();
		await activeTurn;
		await Promise.all([first, second]);

		expect(fixture.continueTurn).toHaveBeenCalledOnce();
		expect(fixture.continueTurn.mock.calls[0]?.[3]).toEqual([contextRecord("first"), contextRecord("second")]);
	});

	it("rejects notifications after the session is closed", async () => {
		const fixture = createFixture();
		const session = await createAgentSession({ id: "session-closed", pipeline: fixture.pipeline });
		await session.close();

		await expect(session.requestContinuation()).rejects.toMatchObject({ code: "session_closed" });
	});

	it("attaches next-turn context after the next explicit user input", async () => {
		const fixture = createFixture();
		const session = await createAgentSession({ id: "session-next-turn", pipeline: fixture.pipeline });
		const context = [contextRecord("next turn")];
		session.queueNextTurnContext(context);

		await session.send({ message: userMessage("prompt") });

		expect(fixture.runTurn.mock.calls[0]?.[1]).toEqual({
			message: userMessage("prompt"),
			trailingContext: context,
		});
	});

	it("records idle context without starting a turn", async () => {
		const fixture = createFixture();
		const session = await createAgentSession({ id: "session-record", pipeline: fixture.pipeline });
		const context = [contextRecord("record only")];

		await session.recordContext(context);

		expect(fixture.recordContext).toHaveBeenCalledWith(expect.anything(), context);
		expect(fixture.runTurn).not.toHaveBeenCalled();
		expect(fixture.continueTurn).not.toHaveBeenCalled();
	});
});

function createFixture(options: { readonly blockRun?: boolean } = {}) {
	let completeRun = (_result: TurnResult = completedTurn("turn-run")) => {};
	const runResult = options.blockRun
		? new Promise<TurnResult>((resolve) => {
				completeRun = (result = completedTurn("turn-run")) => resolve(result);
			})
		: Promise.resolve(completedTurn("turn-run"));
	const runTurn = vi.fn<TurnPipeline["run"]>(() => runResult);
	const continueTurn = vi.fn(
		async (
			_identity: unknown,
			_signal: AbortSignal,
			_inputQueue: unknown,
			_context: readonly SessionContextRecord[] = [],
		) => completedTurn("turn-continuation"),
	);
	const recordContext = vi.fn(async () => {});
	const pipeline = {
		createSession: vi.fn(async (): Promise<StoredConversation> => conversation()),
		run: runTurn,
		continue: continueTurn,
		recordContext,
	} as unknown as TurnPipeline;
	return { pipeline, runTurn, continueTurn, recordContext, completeRun };
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function contextRecord(text: string): SessionContextRecord {
	return {
		type: "test",
		content: [{ type: "text", text }],
		modelVisible: true,
	};
}

function completedTurn(turnId: string): TurnResult {
	return {
		status: "completed",
		sessionId: "session",
		turnId,
		stopReason: "stop",
		messages: [],
	};
}

function conversation(): StoredConversation {
	return {
		sessionId: "session",
		createdAt: 1,
		version: 0,
		messages: [],
		events: [],
	};
}
