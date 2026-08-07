import type { BackgroundCommandService } from "@vetta/runtime-tools/coding";
import { describe, expect, it, vi } from "vitest";
import {
	CodingAgentBackgroundWorkController,
	type CodingAgentSubagentWorkRuntime,
} from "../../src/host/session-execution/background-work-controller.js";

describe("Coding Agent background work controller", () => {
	it("separates subagent cleanup from the combined background cleanup", () => {
		const clearBackground = vi.fn(() => 3);
		const clearSubagents = vi.fn(() => 2);
		const controller = new CodingAgentBackgroundWorkController(
			backgroundService(clearBackground),
			subagentRuntime(clearSubagents),
		);

		expect(controller.clearFinishedSubagents()).toBe(2);
		expect(clearBackground).not.toHaveBeenCalled();
		expect(controller.clearFinished()).toBe(5);
		expect(clearBackground).toHaveBeenCalledOnce();
		expect(clearSubagents).toHaveBeenCalledTimes(2);
	});
});

function backgroundService(clearFinished: () => number): BackgroundCommandService {
	return {
		spawn: () => {
			throw new Error("Not used");
		},
		subscribe: () => () => {},
		subscribeNotifications: () => () => {},
		wait: async () => {
			throw new Error("Not used");
		},
		get: () => undefined,
		list: () => [],
		clearFinished,
		readOutput: () => "",
		stop: () => false,
		dispose() {},
		async shutdown() {},
	};
}

function subagentRuntime(clearFinished: () => number): CodingAgentSubagentWorkRuntime {
	return {
		clearFinished,
		list: () => [],
		interrupt: () => undefined,
	};
}
