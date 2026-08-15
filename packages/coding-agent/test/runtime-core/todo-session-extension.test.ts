import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentTodoRuntime } from "../../src/work-state/todo-runtime.js";
import {
	CODING_AGENT_TODO_CHANGED,
	CODING_AGENT_TODO_CLEAR,
	CODING_AGENT_TODO_READ,
	CODING_AGENT_TODO_RUNTIME,
	createCodingAgentTodoSessionExtension,
} from "../../src/work-state/todo-session-extension.js";

describe("Coding Agent Todo session extension", () => {
	it("contributes the Todo lifecycle through typed session extension contracts", async () => {
		const runtime = new CodingAgentTodoRuntime({ createEntryId: () => "entry", now: () => 1 });
		const dispose = vi.spyOn(runtime, "dispose");
		const reported: string[][] = [];
		const composition = await SessionExtensionComposition.create({
			definitions: [
				createCodingAgentTodoSessionExtension({
					activation: { mode: "explicit", toolNames: ["todo"] },
					createRuntime: () => runtime,
					initialItems: ["Inspect dependencies"],
					reportUpdate: (items) => {
						reported.push(items.map(({ content }) => content));
					},
				}),
			],
		});

		const todo = composition.services.require(CODING_AGENT_TODO_RUNTIME);
		expect(todo.runtime).toBe(runtime);
		expect(todo.toolEnabled).toBe(true);
		expect(composition.features).toHaveLength(1);
		expect(composition.documentParticipants).toHaveLength(1);
		expect(composition.documentParticipants[0]?.dispose).toBeUndefined();
		expect(composition.continuationSources.map(({ id }) => id)).toEqual(["todo"]);
		expect(reported).toEqual([["Inspect dependencies"]]);

		const changed: string[][] = [];
		composition.signals.subscribe(CODING_AGENT_TODO_CHANGED, (items) => {
			changed.push(items.map(({ content }) => content));
		});
		runtime.createMany(["Implement extension"]);
		expect(changed).toEqual([["Inspect dependencies", "Implement extension"]]);
		await expect(composition.invoke(CODING_AGENT_TODO_READ, undefined)).resolves.toHaveLength(2);
		await expect(composition.invoke(CODING_AGENT_TODO_CLEAR, undefined)).resolves.toBe(true);
		await expect(composition.invoke(CODING_AGENT_TODO_READ, undefined)).resolves.toEqual([]);

		await composition.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		await expect(composition.invoke(CODING_AGENT_TODO_READ, undefined)).rejects.toThrow("disposed");
	});
});
