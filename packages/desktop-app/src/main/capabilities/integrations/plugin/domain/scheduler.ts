import {
	DOMAIN_SCHEDULER_CAPABILITIES,
	type SchedulerCommandResult,
	type SchedulerExecutionRecord,
	type SchedulerTask,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginSchedulerMethods = {
	listScheduledTasks(this: PluginCapabilitySessionAccess, sessionId: string): Promise<SchedulerTask[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.LIST_TASKS, {});
	},

	getScheduledTask(this: PluginCapabilitySessionAccess, sessionId: string, taskId: string): Promise<SchedulerTask> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.GET_TASK, { taskId });
	},

	listScheduledTaskHistory(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		taskId: string,
	): Promise<SchedulerExecutionRecord[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.LIST_HISTORY, {
			taskId,
		});
	},

	createScheduledTask(this: PluginCapabilitySessionAccess, sessionId: string, data: unknown): Promise<SchedulerTask> {
		const input = DOMAIN_SCHEDULER_CAPABILITIES.CREATE_TASK.parseInput({ data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.CREATE_TASK, input);
	},

	updateScheduledTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		taskId: string,
		data: unknown,
	): Promise<SchedulerTask> {
		const input = DOMAIN_SCHEDULER_CAPABILITIES.UPDATE_TASK.parseInput({ taskId, data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.UPDATE_TASK, input);
	},

	deleteScheduledTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		taskId: string,
	): Promise<SchedulerCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.DELETE_TASK, {
			taskId,
		});
	},

	setScheduledTaskEnabled(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		taskId: string,
		enabled: boolean,
	): Promise<SchedulerTask> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.SET_ENABLED, {
			taskId,
			enabled,
		});
	},

	runScheduledTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		taskId: string,
	): Promise<SchedulerCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.RUN_TASK, { taskId });
	},

	abortScheduledTask(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		taskId: string,
	): Promise<SchedulerCommandResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SCHEDULER_CAPABILITIES.ABORT_TASK, {
			taskId,
		});
	},
};

export type PluginSchedulerMethods = typeof pluginSchedulerMethods;
