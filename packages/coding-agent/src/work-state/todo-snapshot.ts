import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { TodoSnapshot } from "./contracts.js";

export const TODO_SNAPSHOT_TYPE = "todo_snapshot";

const TodoItemSchema = Type.Object(
	{
		id: Type.Number(),
		content: Type.String(),
		status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done")]),
	},
	{ additionalProperties: false },
);

const TodoSnapshotSchema = Type.Union([
	Type.Array(TodoItemSchema),
	Type.Object(
		{
			items: Type.Array(TodoItemSchema),
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
