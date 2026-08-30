import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import type { KanbanBoardController } from "../src/board/board-controller";
import { registerKanbanTools } from "../src/register-tools";

interface RegistrationMetadata {
	name: string;
}

const registered = new Map<string, RegistrationMetadata>();

beforeAll(() => {
	const ctx = {
		agent: {
			registerTool: (registration: RegistrationMetadata) => {
				registered.set(registration.name, registration);
				return { dispose: () => {} };
			},
		},
	} as unknown as PluginContext;
	registerKanbanTools(ctx, {} as unknown as KanbanBoardController);
});

describe("kanban 工具注册元数据", () => {
	it("注册四个看板工具", () => {
		expect([...registered.keys()]).toEqual([
			"kanban_list_tasks",
			"kanban_add_task",
			"kanban_claim_task",
			"kanban_submit_task",
		]);
	});
});
