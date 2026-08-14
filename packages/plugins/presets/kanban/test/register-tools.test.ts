/**
 * 注册元数据合同。重点：kanban_claim_task 会跨会话拉起独立的后台 agent 循环并产生
 * 模型计费，且不可由本会话回收，必须在注册处声明 heavy——它不在宿主兜底清单里，
 * heavy 判定完全依赖这里的声明。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import type { KanbanBoardController } from "../src/board/board-controller";
import { registerKanbanTools } from "../src/register-tools";

interface RegistrationMetadata {
	name: string;
	side_effect?: "light" | "heavy";
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

	it("claim 在注册处声明 heavy，其余板面操作缺省 light", () => {
		expect(registered.get("kanban_claim_task")?.side_effect).toBe("heavy");
		// list 只读；add/submit 只改板面状态且可改回，不进首调确认闸。
		expect(registered.get("kanban_list_tasks")?.side_effect).toBeUndefined();
		expect(registered.get("kanban_add_task")?.side_effect).toBeUndefined();
		expect(registered.get("kanban_submit_task")?.side_effect).toBeUndefined();
	});
});
