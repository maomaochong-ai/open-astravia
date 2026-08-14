import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { TODO_TOOL_DESCRIPTION } from "./description.js";

export const TodoToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("list"), Type.Literal("clear")], {
		description:
			'Action to perform: "create" (add items), "update" (change status), "list" (show all), or "clear" (abandon the current plan — only allowed for ad-hoc, non-locked lists)',
	}),
	items: Type.Optional(
		Type.Array(Type.String(), { description: 'For action="create": array of step descriptions to add' }),
	),
	id: Type.Optional(Type.Number({ description: 'For action="update": the todo item ID to update' })),
	status: Type.Optional(
		Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done")], {
			description: 'For action="update": new status',
		}),
	),
});

export type TodoToolInput = Static<typeof TodoToolInputSchema>;
export type TodoToolStatus = NonNullable<TodoToolInput["status"]>;

export interface TodoToolItem {
	readonly id: number;
	readonly content: string;
	readonly status: TodoToolStatus;
}

export interface TodoToolStore {
	getAll(): readonly TodoToolItem[];
	isLocked(): boolean;
	getLockSource(): string | null;
	createMany(contents: string[]): readonly TodoToolItem[];
	update(id: number, status: TodoToolStatus): TodoToolItem | undefined;
	clear(): void;
}

export interface TodoToolDetails {
	readonly action: string;
}

export interface TodoToolOptions {
	readonly getTodoStore: () => TodoToolStore;
}

export function createTodoTool(options: TodoToolOptions): RuntimeToolDefinition<TodoToolInput> {
	return {
		name: "todo",
		label: "todo",
		description: TODO_TOOL_DESCRIPTION,
		inputSchema: TodoToolInputSchema,
		async execute({ input: { action, items, id, status } }) {
			const store = options.getTodoStore();
			switch (action) {
				case "create": {
					if (!items || items.length === 0)
						return result(action, 'Error: action="create" requires a non-empty "items" array.');
					if (store.isLocked()) {
						const source = store.getLockSource();
						return result(
							action,
							`REJECTED: The todo list is locked by ${source ?? "the system"} and cannot accept new items.\n` +
								`This list was prefilled from a scene's tasks.json and is the authoritative plan.\n` +
								`Do NOT attempt to create additional todos. Work strictly through the existing items in order:\n` +
								`call todo(action="list") to view them, then todo(action="update", id=N, status="in_progress"|"done").\n\n${formatItems(store)}`,
						);
					}
					if (store.getAll().length > 0) {
						return result(
							action,
							`REJECTED: A todo list already exists. Do not append a new plan to an existing plan.\n` +
								`Call todo(action="list") to review the current plan. If the current plan is obsolete, call todo(action="clear") first, then create the new plan. If it is still relevant, continue updating the existing items.\n\n${formatItems(store)}`,
						);
					}
					const created = store.createMany(items);
					const itemList = created.map((item) => `  #${item.id} ${item.content}`).join("\n");
					return result(action, `Created ${created.length} todo items:\n${itemList}\n\n${formatItems(store)}`);
				}
				case "update": {
					if (id === undefined || !status)
						return result(action, 'Error: action="update" requires "id" (number) and "status".');
					if (store.isLocked() && (status === "in_progress" || status === "done")) {
						const skipped = store.getAll().filter((item) => item.id < id && item.status !== "done");
						if (skipped.length > 0) {
							const firstSkipped = skipped[0];
							const skippedList = skipped
								.map((item) => `  #${item.id} [${item.status}] ${item.content}`)
								.join("\n");
							return result(
								action,
								`REJECTED: Cannot update #${id} to "${status}" because earlier items are not done:\n${skippedList}\n\nYou MUST complete items in order. Work on #${firstSkipped.id} first: "${firstSkipped.content}"\nCall todo(action="update", id=${firstSkipped.id}, status="in_progress") to start it.\n\n${formatItems(store)}`,
							);
						}
					}
					const updated = store.update(id, status);
					return updated
						? result(action, `Updated #${updated.id} → ${updated.status}\n\n${formatItems(store)}`)
						: result(action, `Error: todo item #${id} not found.`);
				}
				case "list":
					return result(action, formatItems(store));
				case "clear": {
					if (store.isLocked()) {
						return result(
							action,
							`REJECTED: The todo list is locked by ${store.getLockSource() ?? "the system"} and cannot be cleared.\n` +
								`This list is the authoritative plan — work strictly through the existing items in order.\n\n${formatItems(store)}`,
						);
					}
					if (store.getAll().length === 0) return result(action, "Todo list is already empty.");
					store.clear();
					return result(
						action,
						'Cleared all todo items. Create a fresh plan with todo(action="create") if the new direction needs one.',
					);
				}
			}
		},
	};
}

function formatItems(store: TodoToolStore): string {
	const items = store.getAll();
	if (items.length === 0) return "No todo items.";
	const statusIcon: Record<TodoToolStatus, string> = { pending: "[ ]", in_progress: "[~]", done: "[x]" };
	const lines = items.map((item) => `${statusIcon[item.status]} #${item.id} ${item.content}`);
	lines.push("", `Progress: ${items.filter((item) => item.status === "done").length}/${items.length} completed`);
	return lines.join("\n");
}

function result(action: string, text: string) {
	return { content: [{ type: "text" as const, text }], details: { action } satisfies TodoToolDetails };
}
