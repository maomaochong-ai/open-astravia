import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { TeamMessageControlPort, TeamTaskControlPort } from "./task-control.js";

export const TeamDelegateTaskInputSchema = Type.Object(
	{
		requestId: Type.String({
			minLength: 1,
			maxLength: 128,
			description:
				"Stable assignment key within this turn. Reuse for a retry of the same assignment; use a different key for different work.",
		}),
		target: Type.String({
			minLength: 1,
			maxLength: 128,
			description: "Persistent Team member handle from team_list_members, without @.",
		}),
		objective: Type.String({ minLength: 1, maxLength: 16_000 }),
	},
	{ additionalProperties: false },
);
export type TeamDelegateTaskInput = Static<typeof TeamDelegateTaskInputSchema>;

export const TeamTaskInputSchema = Type.Object(
	{
		teamTaskId: Type.String({ minLength: 1, maxLength: 2048 }),
	},
	{ additionalProperties: false },
);
export type TeamTaskInput = Static<typeof TeamTaskInputSchema>;

export const TeamWaitTasksInputSchema = Type.Object(
	{
		teamTaskIds: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
			minItems: 1,
			maxItems: 8,
			uniqueItems: true,
		}),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000, default: 30_000 })),
	},
	{ additionalProperties: false },
);
export type TeamWaitTasksInput = Static<typeof TeamWaitTasksInputSchema>;

export const TeamSendMessageInputSchema = Type.Object(
	{
		requestId: Type.String({ minLength: 1, maxLength: 128 }),
		recipients: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
			minItems: 1,
			maxItems: 8,
			uniqueItems: true,
		}),
		intent: Type.Union([Type.Literal("inform"), Type.Literal("question")]),
		text: Type.String({ minLength: 1, maxLength: 16_000 }),
	},
	{ additionalProperties: false },
);
export type TeamSendMessageInput = Static<typeof TeamSendMessageInputSchema>;

export function createTeamDelegateTaskTool(port: TeamTaskControlPort): RuntimeToolDefinition<TeamDelegateTaskInput> {
	return {
		name: "team_delegate_task",
		label: "team_delegate_task",
		description:
			"Assign a bounded objective to an existing persistent Team member. The leader may delegate; ordinary members must not transfer ownership. Returns a durable teamTaskId immediately after admission, without waiting for completion. You can dispatch other members next, then use team_wait_tasks or team_get_task. Never use this to create or address a subagent; subagents are private temporary helpers, not Team members.",
		inputSchema: TeamDelegateTaskInputSchema,
		async execute({ sessionId, turnId, toolCallId, input, signal }) {
			const task = await port.delegateTask({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				toolCallId,
				signal,
				requestId: input.requestId,
				targetHandle: input.target,
				objective: input.objective,
			});
			return { content: [{ type: "text", text: JSON.stringify(task) }], details: task };
		},
	};
}

export function createTeamGetTaskTool(port: TeamTaskControlPort): RuntimeToolDefinition<TeamTaskInput> {
	return {
		name: "team_get_task",
		label: "team_get_task",
		description:
			"Read a durable Team task, its current attempt, waiting reason and published result. This does not start, retry or cancel work and never exposes a member's private execution history. A waiting task is not a failed task.",
		inputSchema: TeamTaskInputSchema,
		async execute({ sessionId, turnId, toolCallId, input, signal }) {
			const task = await port.getTask({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				toolCallId,
				signal,
				...input,
			});
			return { content: [{ type: "text", text: JSON.stringify(task) }], details: task };
		},
	};
}

export function createTeamWaitTasksTool(port: TeamTaskControlPort): RuntimeToolDefinition<TeamWaitTasksInput> {
	return {
		name: "team_wait_tasks",
		label: "team_wait_tasks",
		description:
			"Wait for any of up to eight durable Team tasks to finish, pause or need attention. Use timeoutMs=0 for a snapshot. Timeout or cancelling this wait never cancels or fails the tasks. Do not wait on work queued for yourself while you are executing; circular member waits are rejected. This is not subagent wait_agent.",
		inputSchema: TeamWaitTasksInputSchema,
		async execute({ sessionId, turnId, toolCallId, input, signal }) {
			const result = await port.waitTasks({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				toolCallId,
				signal,
				teamTaskIds: input.teamTaskIds,
				timeoutMs: input.timeoutMs ?? 30_000,
			});
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}

export function createTeamContinueTaskTool(port: TeamTaskControlPort): RuntimeToolDefinition<TeamTaskInput> {
	return createResumeTool(port, "continue");
}

export function createTeamRetryTaskTool(port: TeamTaskControlPort): RuntimeToolDefinition<TeamTaskInput> {
	return createResumeTool(port, "retry");
}

function createResumeTool(port: TeamTaskControlPort, mode: "continue" | "retry"): RuntimeToolDefinition<TeamTaskInput> {
	return {
		name: `team_${mode}_task`,
		label: `team_${mode}_task`,
		description:
			mode === "continue"
				? "Continue a waiting Team task in its existing member conversation when execution ended without a publishable final answer. Only the leader or assigned member may resume it. Returns after admission, not completion. Do not manufacture a final result or repeatedly resume while credits, credentials or another external resource remain unavailable."
				: "Retry a waiting Team task after a transient problem or after its external resource issue has been resolved. Only the leader or assigned member may retry it. Keeps the same teamTaskId and creates a new attempt in the existing conversation. Returns after admission; use team_wait_tasks for results. Do not blindly retry insufficient credits or invalid credentials.",
		inputSchema: TeamTaskInputSchema,
		async execute({ sessionId, turnId, toolCallId, input, signal }) {
			const task = await port.resumeTask({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				toolCallId,
				signal,
				...input,
				mode,
			});
			return { content: [{ type: "text", text: JSON.stringify(task) }], details: task };
		},
	};
}

export function createTeamCancelTaskTool(port: TeamTaskControlPort): RuntimeToolDefinition<TeamTaskInput> {
	return {
		name: "team_cancel_task",
		label: "team_cancel_task",
		description:
			"The leader may cancel one Team task assigned to another member. Other members' tasks are not cancelled. Running work remains running until the runtime acknowledges cancellation; read or wait for its durable state. This does not cancel subagents or change task ownership.",
		inputSchema: TeamTaskInputSchema,
		async execute({ sessionId, turnId, toolCallId, input, signal }) {
			const task = await port.cancelTask({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				toolCallId,
				signal,
				...input,
			});
			return { content: [{ type: "text", text: JSON.stringify(task) }], details: task };
		},
	};
}

export function createTeamSendMessageTool(port: TeamMessageControlPort): RuntimeToolDefinition<TeamSendMessageInput> {
	return {
		name: "team_send_message",
		label: "team_send_message",
		description:
			"Publish a normal Agent message to the shared Team conversation and address one or more persistent members. Use intent=inform when no immediate response is needed; it will enter later shared context without starting a model. Use intent=question only when missing information requires the recipients to respond; recipients run independently. This is public Team communication, not private chat, task ownership transfer, or subagent messaging.",
		inputSchema: TeamSendMessageInputSchema,
		async execute({ sessionId, turnId, toolCallId, input, messages, signal }) {
			const identity = [...(messages ?? [])].reverse().find((message) => message.role === "assistant");
			if (!identity || identity.role !== "assistant")
				throw new Error("Team communication requires the current Agent model identity");
			const result = await port.sendMessage({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				toolCallId,
				signal,
				requestId: input.requestId,
				recipientHandles: input.recipients,
				intent: input.intent,
				text: input.text,
				modelIdentity: { api: identity.api, provider: identity.provider, model: identity.model },
			});
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
