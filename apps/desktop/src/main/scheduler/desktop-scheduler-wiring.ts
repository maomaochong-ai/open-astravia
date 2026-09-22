import type { RuntimeHost } from "@vetta/runtime-core";
import { isConversationCwd } from "../conversations/session-paths.js";
import { DEFAULT_CONVERSATION_CWD, readDesktopConfig } from "../ipc/fs.js";
import { sameProjectPath } from "../projects/project-path.js";
import { syncTaskSchedule, unscheduleTaskInCron } from "./scheduler.js";
import type { SchedulerServiceDependencies } from "./scheduler-service.js";
import { setLegacyMigrationContextProvider } from "./task-storage.js";

/** 项目仍在侧边栏（含归档）才算可用；「对话」恒可用。 */
async function isKnownProject(cwd: string): Promise<boolean> {
	if (isConversationCwd(cwd)) return true;
	const config = await readDesktopConfig();
	return [...(config.projects ?? []), ...(config.archivedProjects ?? [])].some((project) =>
		sameProjectPath(project.path, cwd),
	);
}

export function createDesktopSchedulerDependencies(getRuntime: () => RuntimeHost): SchedulerServiceDependencies {
	// 旧定时任务迁移时，据项目列表推断会话归属；须在首次读取任务前注入。
	setLegacyMigrationContextProvider(async () => {
		const config = await readDesktopConfig();
		const projects = [...(config.projects ?? []), ...(config.archivedProjects ?? [])];
		return {
			conversationCwd: DEFAULT_CONVERSATION_CWD,
			isKnownProject: (cwd) => projects.some((project) => sameProjectPath(project.path, cwd)),
			now: Date.now(),
		};
	});
	return {
		getRuntime,
		syncTask: syncTaskSchedule,
		unscheduleTask: unscheduleTaskInCron,
		isKnownProject,
		sameProjectPath,
	};
}
