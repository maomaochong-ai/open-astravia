import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialBatchTasksApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["batchTasks"] {
	const batchTasks = window.vetta.plugins.internalCapabilities.batchTasks;
	return {
		listProjects: async () => {
			assertOfficial();
			return batchTasks.listProjects(capabilitySessionId);
		},
		getProject: async (projectId) => {
			assertOfficial();
			return batchTasks.getProject(capabilitySessionId, projectId);
		},
		listProjectIds: async () => {
			assertOfficial();
			return (await batchTasks.listProjects(capabilitySessionId)).map((item) => item.id);
		},
		createProject: async (data) => {
			assertOfficial();
			return batchTasks.createProject(capabilitySessionId, data);
		},
		updateProject: async (projectId, data) => {
			assertOfficial();
			return batchTasks.updateProject(capabilitySessionId, projectId, data);
		},
		deleteProject: async (projectId) => {
			assertOfficial();
			await batchTasks.deleteProject(capabilitySessionId, projectId);
			return { projectId, operation: "delete" };
		},
		runTask: async (projectId, taskId) => {
			assertOfficial();
			await batchTasks.runTask(capabilitySessionId, projectId, taskId);
			return { projectId, taskId, operation: "run" };
		},
		retryTask: async (projectId, taskId) => {
			assertOfficial();
			await batchTasks.retryTask(capabilitySessionId, projectId, taskId);
			return { projectId, taskId, operation: "retry" };
		},
		stopTask: async (projectId, taskId) => {
			assertOfficial();
			await batchTasks.stopTask(capabilitySessionId, projectId, taskId);
			return { projectId, taskId, operation: "stop" };
		},
		deleteTask: async (projectId, taskId) => {
			assertOfficial();
			await batchTasks.deleteTask(capabilitySessionId, projectId, taskId);
			return { projectId, taskId, operation: "delete" };
		},
		resumeTask: async (projectId, taskId) => {
			assertOfficial();
			await batchTasks.resumeTask(capabilitySessionId, projectId, taskId);
			return { projectId, taskId, operation: "resume" };
		},
		resumeTaskWithText: async (projectId, taskId, text) => {
			assertOfficial();
			await batchTasks.resumeTaskWithText(capabilitySessionId, projectId, taskId, text);
			return { projectId, taskId, operation: "resume-with-text" };
		},
		deleteTaskSession: async (projectId, taskId) => {
			assertOfficial();
			const result = await batchTasks.deleteTaskSession(capabilitySessionId, projectId, taskId);
			if (result.status === "noop") return { projectId, taskId, operation: "delete-session", status: "noop" };
			return { projectId, taskId, operation: "delete-session" };
		},
		batchDelete: async (projectId) => {
			assertOfficial();
			await batchTasks.deleteAllTasks(capabilitySessionId, projectId);
			return { projectId, operation: "delete-all" };
		},
		batchStart: async (projectId) => {
			assertOfficial();
			await batchTasks.startProject(capabilitySessionId, projectId);
			return { projectId, operation: "start" };
		},
		batchStop: async (projectId) => {
			assertOfficial();
			await batchTasks.stopProject(capabilitySessionId, projectId);
			return { projectId, operation: "stop" };
		},
		batchReset: async (projectId) => {
			assertOfficial();
			await batchTasks.resetProject(capabilitySessionId, projectId);
			return { projectId, operation: "reset" };
		},
		batchResetFailed: async (projectId, taskIds) => {
			assertOfficial();
			await batchTasks.resetFailedTasks(capabilitySessionId, projectId, taskIds);
			return { projectId, taskIds, operation: "reset-failed" };
		},
	};
}
