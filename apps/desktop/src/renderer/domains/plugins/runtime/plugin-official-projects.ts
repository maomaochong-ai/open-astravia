import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialProjectsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["projects"] {
	const projects = window.vetta.plugins.internalCapabilities.projects;
	const sessions = window.vetta.plugins.internalCapabilities.sessions;
	return {
		list: async () => {
			assertOfficial();
			const snapshot = await projects.list(capabilitySessionId);
			return {
				workspacePath: snapshot.workspacePath,
				projects: snapshot.projects.map((entry) => ({ ...entry })),
				archivedProjects: snapshot.archivedProjects.map((entry) => ({ ...entry })),
			};
		},
		listSessions: async (cwd) => {
			assertOfficial();
			return sessions.list(capabilitySessionId, cwd);
		},
		listRuntimeProjects: async () => {
			assertOfficial();
			return sessions.listRuntimeProjects(capabilitySessionId);
		},
		create: async (name, path) => {
			assertOfficial();
			return projects.create(capabilitySessionId, name, path);
		},
		open: async (path, name) => {
			assertOfficial();
			return projects.open(capabilitySessionId, path, name);
		},
		rename: async (path, name) => {
			assertOfficial();
			return projects.rename(capabilitySessionId, path, name);
		},
		archive: async (path) => {
			assertOfficial();
			await projects.archive(capabilitySessionId, path);
		},
		unarchive: async (path) => {
			assertOfficial();
			await projects.unarchive(capabilitySessionId, path);
		},
		remove: async (path) => {
			assertOfficial();
			await projects.remove(capabilitySessionId, path);
		},
	};
}
