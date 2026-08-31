import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UNAVAILABLE_RUNTIME_SESSION_ACCESS } from "../../shared/session-access.js";
import { getProject } from "../batch-tasks/batch-task-storage.js";
import {
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_CWD,
	readDesktopConfig,
} from "../config/desktop-config-store.js";
import { resolveSessionDirForCwd } from "./session-paths.js";
import type { SessionSearchSource } from "./session-search-service.js";

export async function listDesktopSessionSearchSources(): Promise<SessionSearchSource[]> {
	const config = await readDesktopConfig();
	const sources: SessionSearchSource[] = [
		{
			cwd: DEFAULT_CONVERSATION_CWD,
			kind: "conversation",
			sessionDir: resolveSessionDirForCwd(DEFAULT_CONVERSATION_CWD),
		},
		{
			cwd: DEFAULT_IM_CONVERSATION_CWD,
			kind: "claw",
			sessionDir: resolveSessionDirForCwd(DEFAULT_IM_CONVERSATION_CWD),
		},
	];
	for (const { path, name } of config.projects) {
		let batch = false;
		try {
			const meta: unknown = JSON.parse(await readFile(join(path, ".vetta", "meta.json"), "utf8"));
			batch = typeof meta === "object" && meta !== null && Reflect.get(meta, "type") === "batch";
		} catch {
			/* Missing project metadata denotes a regular project. */
		}
		if (!batch) {
			sources.push({ cwd: path, kind: "project", name });
			continue;
		}
		// Read only registered projects; discovery can auto-register folders and must not run during search.
		const project = await getProject(path);
		if (!project) continue;
		const tasks = project.tasks.filter((task) => task.sessionPath);
		sources.push({
			cwd: path,
			kind: "batch",
			name: project.name,
			sessions: tasks.flatMap((task) =>
				task.sessionPath
					? [
							{
								id: task.id,
								path: task.sessionPath,
								cwd: task.cwd,
								name: task.name || undefined,
								firstMessage: task.name || task.id,
								modifiedAt: task.updatedAt,
								access: UNAVAILABLE_RUNTIME_SESSION_ACCESS,
							},
						]
					: [],
			),
			executionModeByPath: new Map(
				tasks.flatMap((task) =>
					task.sessionPath && task.executionMode ? [[resolve(task.sessionPath), task.executionMode] as const] : [],
				),
			),
		});
	}
	return [...new Map(sources.map((source) => [resolve(source.cwd), source])).values()];
}
