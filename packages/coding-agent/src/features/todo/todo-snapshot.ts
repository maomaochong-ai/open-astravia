import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { TodoSnapshot } from "./contracts.js";
import { CodingAgentTodoItemSchema } from "./todo-session-extension-contract.js";

export const TODO_SNAPSHOT_TYPE = "todo_snapshot";

const TodoSnapshotSchema = Type.Union([
	Type.Array(CodingAgentTodoItemSchema),
	Type.Object(
		{
			items: Type.Array(CodingAgentTodoItemSchema),
			lockedBy: Type.Union([Type.Literal("scene"), Type.Null()]),
		},
		{ additionalProperties: false },
	),
]);

export function parseTodoSnapshot(value: unknown, entryId: string): TodoSnapshot {
	if (!Value.Check(TodoSnapshotSchema, value)) {
		throw new Error(`Invalid ${TODO_SNAPSHOT_TYPE} entry: ${entryId}`);
	}
	return value as TodoSnapshot;
}
