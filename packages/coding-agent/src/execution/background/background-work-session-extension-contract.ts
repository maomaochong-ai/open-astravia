import { defineSessionExtensionEndpoint } from "@vetta/runtime-core/session-extensions";
import type { BackgroundCommandSnapshot } from "@vetta/runtime-tools";
import type { CodingAgentSubagentSnapshot } from "../../runtime-contracts/index.js";

export const CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID = "coding-agent.background-work";

export const CODING_AGENT_BACKGROUND_TASKS_READ = defineSessionExtensionEndpoint<
	void,
	readonly BackgroundCommandSnapshot[]
>(CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID, "tasks.read");

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
