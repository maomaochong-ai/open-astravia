import type { BackgroundCommandSnapshot } from "@astravia/runtime-tools";
import { describe, expect, it } from "vitest";
import { buildCodingAgentBackgroundCommandNotification } from "../../src/execution/background/notification.js";

const completed: BackgroundCommandSnapshot = {
	id: "b1",
	command: "echo done",
	cwd: "C:/workspace",
	status: "completed",
	outputFile: "C:/tmp/task.log",
	exitCode: 0,
	startedAt: 1,
	endedAt: 2,
	toolCallId: "tool-call-1",
	tail: "done",
};

describe("Coding Agent background command notification", () => {
	it("formats a completed command for model context", () => {
		expect(buildCodingAgentBackgroundCommandNotification(completed)).toContain("<status>completed</status>");
	});

	it("carries the exit code and the tail of the output so the result cannot be lost", () => {
		const notification = buildCodingAgentBackgroundCommandNotification(completed);
		expect(notification).toContain("<exit-code>0</exit-code>");
		expect(notification).toContain("<output-tail>\ndone</output-tail>");
		expect(notification).toContain("Use the task_output tool to read more.");
	});

	it("reports an unavailable result explicitly when no output was captured", () => {
		const notification = buildCodingAgentBackgroundCommandNotification({
			...completed,
			exitCode: undefined,
			tail: "",
		});
		expect(notification).toContain("<exit-code>unknown</exit-code>");
		expect(notification).toContain("<output-tail>(no output captured)</output-tail>");
		expect(notification).toContain("No output was captured for this command.");
	});

	it("bounds the inlined output tail", () => {
		const notification = buildCodingAgentBackgroundCommandNotification({
			...completed,
			tail: "x".repeat(5000),
		});
		const tail = /<output-tail>\n([\s\S]*?)<\/output-tail>/.exec(notification)?.[1];
		expect(tail).toHaveLength(2000);
	});

	it("retains caller cancellation guidance in the product layer", () => {
		const stopped: BackgroundCommandSnapshot = {
			id: "b2",
			command: "server",
			cwd: "C:/workspace",
			status: "killed",
			outputFile: "C:/tmp/task.log",
			exitCode: undefined,
			startedAt: 1,
			endedBy: "caller",
			tail: "",
		};
		const notification = buildCodingAgentBackgroundCommandNotification(stopped);
		expect(notification).toContain("The user manually stopped");
		expect(notification).toContain("<status>killed</status>");
	});
});
