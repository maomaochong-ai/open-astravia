import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialSchedulerApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["scheduler"] {
	const scheduler = window.vetta.plugins.internalCapabilities.scheduler;
	return {
		listTasks: async () => {
			assertOfficial();
			return scheduler.listTasks(capabilitySessionId);
		},
		getTask: async (taskId) => {
			assertOfficial();
			return scheduler.getTask(capabilitySessionId, taskId);
		},
		listTaskIds: async () => {
			assertOfficial();
			return (await scheduler.listTasks(capabilitySessionId)).map((item) => item.id);
		},
		getHistory: async (taskId) => {
			assertOfficial();
			return scheduler.listHistory(capabilitySessionId, taskId);
		},
		createTask: async (data) => {
			assertOfficial();
			return scheduler.createTask(capabilitySessionId, { ...data, enabled: data.enabled ?? true });
		},
		updateTask: async (taskId, data) => {
			assertOfficial();
			const { modelKey, skill, ...rest } = data;
			const patch = {
				...rest,
				...("modelKey" in data ? { modelKey: modelKey ?? undefined } : {}),
				...("skill" in data ? { skill: skill ?? undefined } : {}),
			};
			return scheduler.updateTask(capabilitySessionId, taskId, patch);
		},
		deleteTask: async (taskId) => {
			assertOfficial();
			await scheduler.deleteTask(capabilitySessionId, taskId);
			return { taskId, operation: "delete" };
		},
		setEnabled: async (taskId, enabled) => {
			assertOfficial();
			return scheduler.setEnabled(capabilitySessionId, taskId, enabled);
		},
		runNow: async (taskId) => {
			assertOfficial();
			await scheduler.runTask(capabilitySessionId, taskId);
			return { taskId, operation: "run-now" };
		},
		abort: async (taskId) => {
			assertOfficial();
			await scheduler.abortTask(capabilitySessionId, taskId);
			return { taskId, operation: "abort" };
		},
	};
}
