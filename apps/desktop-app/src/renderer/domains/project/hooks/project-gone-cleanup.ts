/**
 * 项目从侧边栏消失（移除 / 归档 / 硬删除）后，右侧视图该怎么收场。
 *
 * 判断散在回调里时只覆盖了 `/project/$cwd` 一条路由，停在该项目的新会话页或
 * 它名下的会话上时右侧会继续渲染一个已经不存在的项目——新会话页甚至还能接着
 * 发消息，把会话建回刚删掉的目录。这里把「要不要走、走去哪」收成纯函数。
 */
export interface ProjectGoneRouteContext {
	/** 当前路由 pathname，用于区分 `/`、`/project/$cwd`、`/new-session/$cwd`、`/viewer/$path`。 */
	readonly currentPath: string;
	/** 当前路由的 `cwd` 参数，已解码；该路由没有这个参数时为空串。 */
	readonly routeCwd: string;
	/** 当前路由的 `path` 参数（viewer 页正在看的会话），已解码；没有则为空串。 */
	readonly routeSessionPath: string;
	readonly activeSessionCwd: string;
	readonly activeSessionPath: string;
	/** 默认「对话」项目根；配置还没读回来时为空串。 */
	readonly defaultConversationCwd: string;
}

export type ProjectGoneNavigation =
	| { readonly kind: "stay" }
	| { readonly kind: "new-session"; readonly cwd: string }
	/** 默认「对话」cwd 还没解析出来时的兜底，等价于旧行为。 */
	| { readonly kind: "home" };

export interface ProjectGoneCleanup {
	readonly clearActiveSession: boolean;
	readonly navigation: ProjectGoneNavigation;
}

export function resolveProjectGoneCleanup(
	projectCwd: string,
	sessionPathsInProject: readonly string[],
	context: ProjectGoneRouteContext,
): ProjectGoneCleanup {
	const activeBelongsToProject =
		(context.activeSessionCwd !== "" && context.activeSessionCwd === projectCwd) ||
		(context.activeSessionPath !== "" && sessionPathsInProject.includes(context.activeSessionPath));

	const onProjectScopedRoute =
		(context.currentPath.startsWith("/project/") || context.currentPath.startsWith("/new-session/")) &&
		context.routeCwd === projectCwd;
	const onViewerForProjectSession =
		context.currentPath.startsWith("/viewer/") &&
		context.routeSessionPath !== "" &&
		sessionPathsInProject.includes(context.routeSessionPath);
	// 会话页（`/`）不带项目信息，只能靠 activeSession 判断归属。
	const onChatPageForProject = context.currentPath === "/" && activeBelongsToProject;

	const mustLeave = onProjectScopedRoute || onViewerForProjectSession || onChatPageForProject;
	if (!mustLeave) return { clearActiveSession: activeBelongsToProject, navigation: { kind: "stay" } };

	return {
		clearActiveSession: activeBelongsToProject,
		navigation: context.defaultConversationCwd
			? { kind: "new-session", cwd: context.defaultConversationCwd }
			: { kind: "home" },
	};
}
