import { defaultConversationCwdAtom, projectsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import {
	type ProjectOption,
	type ProjectSelection,
	resolveActivityPanelCwd,
	resolveContextCwd,
	resolveInitialSelection,
	selectableProjects,
} from "./project-selection";

export interface NewSessionProjectSelectionModel {
	/** 当前选择；null 表示「不指定项目」。 */
	readonly selection: ProjectSelection;
	/** 发送目标、@文件补全、拖拽落点与技能列表都用它。 */
	readonly contextCwd: string;
	/** 活动面板根目录；「对话」与待创建项目没有可浏览的目录，为 null 走空态。 */
	readonly activityPanelCwd: string | null;
	readonly options: readonly ProjectOption[];
	/** 已被占用的项目名，供「新建项目」对话框判重。 */
	readonly takenNames: readonly string[];
	/** 选中已有项目；传 null 回到未选中态。 */
	readonly selectProject: (cwd: string | null) => void;
	/** 记下一个待创建的项目：目录要等到点发送时才落盘。 */
	readonly selectPendingProject: (name: string) => void;
	/** 待创建项目落盘后把选择换成真实项目。 */
	readonly applyCreatedProject: (cwd: string, name: string) => void;
}

/**
 * 新会话页的项目选择状态。刻意只活在页面本地：切换项目不动路由，
 * 也就不会触发按 cwd 隔离的草稿作用域切换，用户已经打好的正文不会被换走。
 */
export function useNewSessionProjectSelection(routeCwd: string): NewSessionProjectSelectionModel {
	const projects = useAtomValue(projectsAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	// undefined = 用户还没碰过选择器，选中值由路由推导（项目列表异步补齐时名字也跟着修正）。
	const [override, setOverride] = useState<ProjectSelection | undefined>(undefined);
	// 路由 cwd 变了就是换了一次「新会话入口」，本地覆盖作废，重新按入口推导。
	const [overrideCwd, setOverrideCwd] = useState(routeCwd);
	const effectiveOverride = overrideCwd === routeCwd ? override : undefined;

	const selection = useMemo(
		() =>
			effectiveOverride !== undefined
				? effectiveOverride
				: resolveInitialSelection({ routeCwd, defaultConversationCwd, projects }),
		[effectiveOverride, routeCwd, defaultConversationCwd, projects],
	);

	const options = useMemo(
		() => selectableProjects(projects, defaultConversationCwd),
		[projects, defaultConversationCwd],
	);

	const takenNames = useMemo(
		() => projects.map((project) => project.name).filter((name): name is string => Boolean(name)),
		[projects],
	);

	const setSelection = useCallback(
		(next: ProjectSelection) => {
			setOverrideCwd(routeCwd);
			setOverride(next);
		},
		[routeCwd],
	);

	const selectProject = useCallback(
		(cwd: string | null) => {
			if (cwd === null) {
				setSelection(null);
				return;
			}
			const option = options.find((candidate) => candidate.cwd === cwd);
			setSelection({ kind: "project", cwd, name: option?.name ?? cwd });
		},
		[options, setSelection],
	);

	const selectPendingProject = useCallback(
		(name: string) => setSelection({ kind: "pending-create", name }),
		[setSelection],
	);

	const applyCreatedProject = useCallback(
		(cwd: string, name: string) => setSelection({ kind: "project", cwd, name }),
		[setSelection],
	);

	return {
		selection,
		contextCwd: resolveContextCwd({ selection, routeCwd, defaultConversationCwd }),
		activityPanelCwd: resolveActivityPanelCwd(selection),
		options,
		takenNames,
		selectProject,
		selectPendingProject,
		applyCreatedProject,
	};
}
