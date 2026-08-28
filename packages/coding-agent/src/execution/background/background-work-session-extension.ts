import {
	defineSessionExtensionService,
	type SessionExtensionDefinition,
	sessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import {
	CODING_AGENT_BACKGROUND_TASK_KILL,
	CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED,
	CODING_AGENT_BACKGROUND_TASKS_OBSERVATION,
	CODING_AGENT_BACKGROUND_TASKS_READ,
	CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
	CODING_AGENT_SUBAGENT_INTERRUPT,
	CODING_AGENT_SUBAGENTS_CLEAR_FINISHED,
	CODING_AGENT_SUBAGENTS_READ,
} from "./background-work-session-extension-contract.js";
import type { CodingAgentBackgroundWorkRuntime } from "./work-controller.js";

export interface CodingAgentBackgroundWorkRuntimeOwner {
	attach(runtime: CodingAgentBackgroundWorkRuntime): void;
	read(): CodingAgentBackgroundWorkRuntime | undefined;
}

export const CODING_AGENT_BACKGROUND_WORK_RUNTIME_OWNER =
	defineSessionExtensionService<CodingAgentBackgroundWorkRuntimeOwner>(
		CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
		"runtime-owner",
	);

/**
 * Coding 产品的后台命令与 Subagent 控制面。
 *
 * Runtime Core 只路由类型化 Endpoint；具体工作状态、命令语义和 Subagent 快照由本扩展拥有。
 */
export function createCodingAgentBackgroundWorkSessionExtension(): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID,
		create() {
			let runtime: CodingAgentBackgroundWorkRuntime | undefined;
			const owner: CodingAgentBackgroundWorkRuntimeOwner = {
				attach(next) {
					if (runtime) throw new Error("Coding Agent background work runtime is already attached");
					runtime = next;
				},
				read: () => runtime,
			};
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_BACKGROUND_WORK_RUNTIME_OWNER, value: owner },
					{
						kind: "initial-observation-source",
						source: {
							id: `${CODING_AGENT_BACKGROUND_WORK_EXTENSION_ID}.initial-state`,
							read: () => {
								const tasks = runtime?.readTasks() ?? [];
								return tasks.length > 0
									? [sessionExtensionObservation(CODING_AGENT_BACKGROUND_TASKS_OBSERVATION, tasks)]
									: [];
							},
						},
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_BACKGROUND_TASKS_READ,
						handle: () => [...requireRuntime(runtime).readTasks()],
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED,
						handle: () => requireRuntime(runtime).clearFinishedTasks?.() ?? 0,
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_BACKGROUND_TASK_KILL,
						handle: ({ taskId }) => requireRuntime(runtime).killTask(taskId),
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_SUBAGENTS_READ,
						handle: () => [...requireRuntime(runtime).readSubagents()],
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_SUBAGENTS_CLEAR_FINISHED,
						handle: () => requireRuntime(runtime).clearFinishedSubagents?.() ?? 0,
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_SUBAGENT_INTERRUPT,
						handle: ({ target }) => requireRuntime(runtime).interruptSubagent(target),
					},
				],
				dispose() {
					runtime = undefined;
				},
			};
		},
	};
}

function requireRuntime(runtime: CodingAgentBackgroundWorkRuntime | undefined): CodingAgentBackgroundWorkRuntime {
	if (!runtime) throw new Error("Coding Agent background work runtime has not been attached");
	return runtime;
}
