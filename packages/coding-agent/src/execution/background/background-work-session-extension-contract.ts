import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { SessionEvent } from "@vetta/runtime-core";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import type { BackgroundCommandSnapshot } from "@vetta/runtime-tools";
import type { CodingAgentSubagentSnapshot } from "../../runtime-contracts/index.js";

export const CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID = "coding-agent.background-work";

export const CODING_AGENT_BACKGROUND_TASKS_READ = defineSessionExtensionEndpoint<
	void,
	readonly BackgroundCommandSnapshot[]
>(CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID, "tasks.read");

export const CODING_AGENT_BACKGROUND_TASKS_OBSERVATION = defineSessionExtensionObservation<
	readonly BackgroundCommandSnapshot[]
>(CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID, "tasks.changed");

export const CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED = defineSessionExtensionEndpoint<void, number>(
	CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
	"tasks.clear-finished",
);

export const CODING_AGENT_BACKGROUND_TASK_KILL = defineSessionExtensionEndpoint<{ readonly taskId: string }, boolean>(
	CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
	"tasks.kill",
);

export const CODING_AGENT_SUBAGENTS_READ = defineSessionExtensionEndpoint<void, readonly CodingAgentSubagentSnapshot[]>(
	CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
	"subagents.read",
);

export const CODING_AGENT_SUBAGENTS_CLEAR_FINISHED = defineSessionExtensionEndpoint<void, number>(
	CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
	"subagents.clear-finished",
);

export const CODING_AGENT_SUBAGENT_INTERRUPT = defineSessionExtensionEndpoint<
	{ readonly target: string },
	CodingAgentSubagentSnapshot | undefined
>(CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID, "subagents.interrupt");

const BackgroundCommandSnapshotSchema = Type.Object(
	{
		id: Type.String(),
		command: Type.String(),
		cwd: Type.String(),
		status: Type.Union([
			Type.Literal("running"),
			Type.Literal("completed"),
			Type.Literal("failed"),
			Type.Literal("killed"),
		]),
		outputFile: Type.String(),
		exitCode: Type.Optional(Type.Number()),
		startedAt: Type.Number(),
		endedAt: Type.Optional(Type.Number()),
		toolCallId: Type.Optional(Type.String()),
		tail: Type.String(),
		endedBy: Type.Optional(Type.Union([Type.Literal("caller"), Type.Literal("agent"), Type.Literal("dispose")])),
	},
	{ additionalProperties: false },
);

const BackgroundCommandSnapshotsSchema = Type.Array(BackgroundCommandSnapshotSchema);

/** 在宿主边界校验后台命令快照；Runtime Core 只路由 opaque payload。 */
export function readCodingAgentBackgroundTasksObservation(
	event: SessionEvent,
): readonly BackgroundCommandSnapshot[] | undefined {
	if (
		event.type !== "session.extension" ||
		event.extensionId !== CODING_AGENT_BACKGROUND_TASKS_OBSERVATION.extensionId ||
		event.event !== CODING_AGENT_BACKGROUND_TASKS_OBSERVATION.event ||
		!Value.Check(BackgroundCommandSnapshotsSchema, event.payload)
	) {
		return undefined;
	}
	return event.payload.map((task) => ({ ...task, exitCode: task.exitCode }));
}
