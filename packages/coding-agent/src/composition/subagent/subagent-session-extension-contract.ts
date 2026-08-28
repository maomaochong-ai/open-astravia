import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { SessionEvent } from "@vetta/runtime-core";
import { defineSessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import type { CodingAgentSubagentSnapshot } from "../../runtime-contracts/index.js";

export const CODING_AGENT_SUBAGENT_EXTENSION_ID = "coding-agent.subagents";

export const CODING_AGENT_SUBAGENTS_OBSERVATION = defineSessionExtensionObservation<
	readonly CodingAgentSubagentSnapshot[]
>(CODING_AGENT_SUBAGENT_EXTENSION_ID, "changed");

const CodingAgentSubagentSnapshotSchema = Type.Object(
	{
		id: Type.String(),
		taskName: Type.String(),
		path: Type.String(),
		agentType: Type.String(),
		status: Type.Union([
			Type.Literal("queued"),
			Type.Literal("pending"),
			Type.Literal("running"),
			Type.Literal("completed"),
			Type.Literal("failed"),
			Type.Literal("interrupted"),
		]),
		task: Type.String(),
		parentSessionId: Type.String(),
		sessionFile: Type.Optional(Type.String()),
		startedAt: Type.Number(),
		endedAt: Type.Optional(Type.Number()),
		finalText: Type.Optional(Type.String()),
		errorMessage: Type.Optional(Type.String()),
		usage: Type.Object(
			{
				input: Type.Number(),
				output: Type.Number(),
				cacheRead: Type.Number(),
				cacheWrite: Type.Number(),
				costTotal: Type.Number(),
			},
			{ additionalProperties: false },
		),
		generation: Type.Number(),
		todoProgress: Type.Optional(
			Type.Object({ done: Type.Number(), total: Type.Number() }, { additionalProperties: false }),
		),
		title: Type.Optional(Type.String()),
		deliveryMode: Type.Optional(Type.Union([Type.Literal("terminal"), Type.Literal("batch")])),
		batchId: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const CodingAgentSubagentSnapshotsSchema = Type.Array(CodingAgentSubagentSnapshotSchema);

/** 在宿主边界校验 Coding Agent 子代理产品快照；Runtime Core 只路由 opaque payload。 */
export function readCodingAgentSubagentsObservation(
	event: SessionEvent,
): readonly CodingAgentSubagentSnapshot[] | undefined {
	if (
		event.type !== "session.extension" ||
		event.extensionId !== CODING_AGENT_SUBAGENTS_OBSERVATION.extensionId ||
		event.event !== CODING_AGENT_SUBAGENTS_OBSERVATION.event ||
		!Value.Check(CodingAgentSubagentSnapshotsSchema, event.payload)
	) {
		return undefined;
	}
	return event.payload.map((snapshot) => ({
		...snapshot,
		usage: { ...snapshot.usage },
		...(snapshot.todoProgress ? { todoProgress: { ...snapshot.todoProgress } } : {}),
	}));
}
