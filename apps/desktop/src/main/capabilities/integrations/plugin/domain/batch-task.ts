import { type BatchProject, type BatchTaskCommandResult, DOMAIN_BATCH_TASK_CAPABILITIES } from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginBatchTaskMethods = {
	listBatchProjects(this: PluginCapabilitySessionAccess, sessionId: string): Promise<BatchProject[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.LIST_PROJECTS, {});
	},

	getBatchProject(this: PluginCapabilitySessionAccess, sessionId: string, projectId: string): Promise<BatchProject> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.GET_PROJECT, {
			projectId,
		});
	},

	createBatchProject(this: PluginCapabilitySessionAccess, sessionId: string, data: unknown): Promise<BatchProject> {
		const input = DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT.parseInput({ data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT, input);
	},

	updateBatchProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		data: unknown,
	): Promise<BatchProject> {
		const input = DOMAIN_BATCH_TASK_CAPABILITIES.UPDATE_PROJECT.parseInput({ projectId, data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.UPDATE_PROJECT, input);
	},

	deleteBatchProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_PROJECT, {
			projectId,
		});
	},

	runBatchTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.RUN_TASK, {
			projectId,
			taskId,
		});
	},

	retryBatchTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.RETRY_TASK, {
			projectId,
			taskId,
		});
	},

	stopBatchTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.STOP_TASK, {
			projectId,
			taskId,
		});
	},

	deleteBatchTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_TASK, {
			projectId,
			taskId,
		});
	},

	resumeBatchTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.RESUME_TASK, {
			projectId,
			taskId,
		});
	},

	resumeBatchTaskWithText(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
		text: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.RESUME_TASK_WITH_TEXT, {
			projectId,
			taskId,
			text,
		});
	},

	deleteBatchTaskSession(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_TASK_SESSION, {
			projectId,
			taskId,
		});
	},

	deleteAllBatchTasks(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_ALL_TASKS, {
			projectId,
		});
	},

	startBatchProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.START_PROJECT, {
			projectId,
		});
	},

	stopBatchProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.STOP_PROJECT, {
			projectId,
		});
	},

	resetBatchProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.RESET_PROJECT, {
			projectId,
		});
	},

	resetFailedBatchTasks(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		projectId: string,
		taskIds: string[],
	): Promise<BatchTaskCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_BATCH_TASK_CAPABILITIES.RESET_FAILED_TASKS, {
			projectId,
			taskIds,
		});
	},
};

export type PluginBatchTaskMethods = typeof pluginBatchTaskMethods;
