import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODING_AGENT_BACKGROUND_WORK_RUNTIME_OWNER,
	createCodingAgentBackgroundWorkSessionExtension,
} from "../../src/execution/background/background-work-session-extension.js";
import {
	CODING_AGENT_BACKGROUND_TASK_KILL,
	CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED,
	CODING_AGENT_BACKGROUND_TASKS_READ,
	CODING_AGENT_SUBAGENT_INTERRUPT,
	CODING_AGENT_SUBAGENTS_CLEAR_FINISHED,
	CODING_AGENT_SUBAGENTS_READ,
} from "../../src/execution/background/background-work-session-extension-contract.js";
import type { CodingAgentBackgroundWorkRuntime } from "../../src/execution/background/work-controller.js";

describe("Coding Agent background work Session Extension", () => {
	let composition: SessionExtensionComposition | undefined;

	afterEach(async () => {
		await composition?.dispose();
		composition = undefined;
	});

	it("exposes product controls through typed endpoints after the runtime is attached", async () => {
		const task = {
			id: "task-1",
			command: "bun test",
			cwd: "/workspace",
			status: "running" as const,
			outputFile: "/tmp/task-1.log",
			exitCode: undefined,
			startedAt: 1,
			tail: "",
		};
		const subagent = {
			id: "child-1",
			taskName: "review",
			path: "/root/review",
			agentType: "reviewer",
			status: "running" as const,
			task: "Review the change",
			parentSessionId: "parent",
			startedAt: 1,
			generation: 1,
			usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costTotal: 0 },
		};
		const runtime: CodingAgentBackgroundWorkRuntime = {
			clearFinished: () => 5,
			clearFinishedTasks: () => 2,
			clearFinishedSubagents: () => 3,
			killTask: (taskId) => taskId === task.id,
			readTasks: () => [task],
			readSubagents: () => [subagent],
			interruptSubagent: (target) => (target === subagent.id ? subagent : undefined),
		};

		composition = await SessionExtensionComposition.create({
			definitions: [createCodingAgentBackgroundWorkSessionExtension()],
		});
		composition.services.require(CODING_AGENT_BACKGROUND_WORK_RUNTIME_OWNER).attach(runtime);

		await expect(composition.invoke(CODING_AGENT_BACKGROUND_TASKS_READ, undefined)).resolves.toEqual([task]);
		await expect(composition.invoke(CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED, undefined)).resolves.toBe(2);
		await expect(composition.invoke(CODING_AGENT_BACKGROUND_TASK_KILL, { taskId: task.id })).resolves.toBe(true);
		await expect(composition.invoke(CODING_AGENT_SUBAGENTS_READ, undefined)).resolves.toEqual([subagent]);
		await expect(composition.invoke(CODING_AGENT_SUBAGENTS_CLEAR_FINISHED, undefined)).resolves.toBe(3);
		await expect(composition.invoke(CODING_AGENT_SUBAGENT_INTERRUPT, { target: subagent.id })).resolves.toEqual(
			subagent,
		);
	});

	it("fails explicitly before the product runtime is attached", async () => {
		composition = await SessionExtensionComposition.create({
			definitions: [createCodingAgentBackgroundWorkSessionExtension()],
		});

		await expect(composition.invoke(CODING_AGENT_BACKGROUND_TASKS_READ, undefined)).rejects.toThrow(
			"background work runtime has not been attached",
		);
	});
});
