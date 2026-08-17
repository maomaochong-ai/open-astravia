import type {
	BackgroundCommandService,
	BackgroundCommandSnapshot,
	BackgroundCommandStopReason,
} from "@vetta/runtime-tools";
import { describe, expect, it } from "vitest";
import {
	createTaskOutputToolRegistration,
	createTaskStopToolRegistration,
	truncateBackgroundTaskOutputTail,
} from "../../../src/features/background-tasks/index.js";

describe("background task Tools", () => {
	it("reads incremental output, stops running tasks and preserves registration metadata", async () => {
		const fixture = createBackgroundServiceFixture();
		const outputRegistration = createTaskOutputToolRegistration({ backgroundService: fixture.service });
		const stopRegistration = createTaskStopToolRegistration({ backgroundService: fixture.service });

		expect(outputRegistration).toMatchObject({ category: "agent-control", requires: ["bg-tasks"] });
		expect(stopRegistration).toMatchObject({ category: "agent-control", requires: ["bg-tasks"] });
		const first = await outputRegistration.tool.execute(request("output", { task_id: "b1", from_start: true }));
		const second = await outputRegistration.tool.execute(request("output-2", { task_id: "b1" }));
		const stopped = await stopRegistration.tool.execute(request("stop", { task_id: "b1" }));

		expect(first.content[0]).toMatchObject({ text: expect.stringContaining("task-output-ok") });
		expect(second.content[0]).toMatchObject({ text: expect.stringContaining("no new output since last read") });
		expect(stopped.content[0]).toMatchObject({ text: expect.stringContaining("Sent kill signal to task b1") });
		expect(fixture.readStopReason()).toBe("agent");
	});

	it("rejects an unknown task", async () => {
		const { service } = createBackgroundServiceFixture();
		const tool = createTaskOutputToolRegistration({ backgroundService: service }).tool;

		await expect(tool.execute(request("missing", { task_id: "missing" }))).rejects.toThrow(
			'Background task "missing" not found.',
		);
	});

	it("keeps the tail within UTF-8 byte and line budgets", () => {
		expect(truncateBackgroundTaskOutputTail("one\ntwo\nthree", { maxLines: 2 })).toEqual({
			content: "two\nthree",
			truncated: true,
		});
		expect(truncateBackgroundTaskOutputTail("甲乙丙", { maxBytes: 6 })).toEqual({
			content: "乙丙",
			truncated: true,
		});
	});
});

function createBackgroundServiceFixture(): {
	readonly service: BackgroundCommandService;
	readonly readStopReason: () => BackgroundCommandStopReason | undefined;
} {
	let output = "task-output-ok";
	let stopReason: BackgroundCommandStopReason | undefined;
	const snapshot: BackgroundCommandSnapshot = {
		id: "b1",
		command: "long command",
		cwd: "C:/workspace",
		status: "running",
		outputFile: "C:/tmp/task.log",
		exitCode: undefined,
		startedAt: 1,
		tail: "task-output-ok",
	};
	const service: BackgroundCommandService = {
		spawn: () => snapshot,
		subscribe: () => () => {},
		subscribeNotifications: () => () => {},
		wait: async () => ({ stillRunning: true, snapshot }),
		get: (taskId) => (taskId === snapshot.id ? snapshot : undefined),
		list: () => [snapshot],
		clearFinished: () => 0,
		readOutput: () => {
			const value = output;
			output = "";
			return value;
		},
		stop: (_taskId, reason) => {
			stopReason = reason;
			return true;
		},
		dispose() {},
		async shutdown() {},
	};
	return { service, readStopReason: () => stopReason };
}

function request<TInput>(toolCallId: string, input: TInput) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId,
		input,
		signal: new AbortController().signal,
	};
}
