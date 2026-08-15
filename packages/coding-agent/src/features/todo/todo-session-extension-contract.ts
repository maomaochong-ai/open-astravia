import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { SessionEvent } from "@vetta/runtime-core";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import type { TodoItem } from "./contracts.js";

export const CODING_AGENT_TODO_EXTENSION_ID = "coding-agent.todo";

export const CODING_AGENT_TODO_READ = defineSessionExtensionEndpoint<void, readonly TodoItem[]>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"read",
);

export const CODING_AGENT_TODO_CLEAR = defineSessionExtensionEndpoint<void, boolean>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"clear",
);

export const CODING_AGENT_TODO_OBSERVATION = defineSessionExtensionObservation<readonly TodoItem[]>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"changed",
);

export const CodingAgentTodoItemSchema = Type.Object(
	{
		id: Type.Number(),
		content: Type.String(),
		status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done")]),
	},
	{ additionalProperties: false },
);

const CodingAgentTodoItemsSchema = Type.Array(CodingAgentTodoItemSchema);

/** 在宿主协议边界识别并校验 Coding Agent Todo 观察；其他扩展事件返回 undefined。 */
export function readCodingAgentTodoObservation(event: SessionEvent): readonly TodoItem[] | undefined {
	if (
		event.type !== "session.extension" ||
		event.extensionId !== CODING_AGENT_TODO_OBSERVATION.extensionId ||
		event.event !== CODING_AGENT_TODO_OBSERVATION.event ||
		!Value.Check(CodingAgentTodoItemsSchema, event.payload)
	) {
		return undefined;
	}
	return event.payload.map((item) => ({ ...item }));
}
