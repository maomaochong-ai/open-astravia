import type { BackgroundCommandSnapshot } from "@vetta/runtime-tools";
import { describe, expect, it } from "vitest";
import { buildCodingAgentBackgroundCommandNotification } from "../../src/execution/background/notification.js";

describe("Coding Agent background command notification", () => {
	it("formats a completed command for model context", () => {
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
		expect(buildCodingAgentBackgroundCommandNotification(completed)).toContain("<status>completed</status>");
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
		expect(buildCodingAgentBackgroundCommandNotification(stopped)).toContain("The user manually stopped");
	});
});
