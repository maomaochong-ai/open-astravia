/**
 * 新会话页「项目选择」的全部决策逻辑，与 React 解耦。
 *
 * 页面本身仍由路由参数 `/new-session/$cwd` 决定进入时的上下文，选择器只在页面本地
 * 覆盖它——不切路由，因此输入框里已经打好的草稿不会因为换项目被换走。发送目标、
 * @文件补全根目录、活动面板与技能列表都读这里算出的 cwd。
 */

/** 供选择器展示的项目条目（默认「对话」、批量任务项目与归档项目都不在其中）。 */
export interface ProjectOption {
	readonly cwd: string;
	readonly name: string;
}

/** 已存在的项目：cwd 可能不在 {@link selectableProjects} 里（批量/插件传入的任意目录）。 */
export interface ExistingProjectSelection {
	readonly kind: "project";
	readonly cwd: string;
	readonly name: string;
}

/** 用户在「新建项目」里填好了名字，但目录要等到点发送时才真正创建。 */
export interface PendingProjectSelection {
	readonly kind: "pending-create";
	readonly name: string;
}

/** `null` 表示未选中，即「不指定项目」，会话落到默认「对话」项目。 */
export type ProjectSelection = ExistingProjectSelection | PendingProjectSelection | null;

/** 项目数超过这个值时，popover 顶部才出现搜索框。 */
export const PROJECT_SEARCH_THRESHOLD = 5;

interface ProjectLike {
	readonly cwd: string;
	readonly name?: string;
	readonly type?: string;
	readonly isDefault?: boolean;
}

function basename(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * 可选项目 = 侧边栏「项目」区那一份：排除默认「对话」（它就是未选中态本身）与批量任务项目
 * （批量项目有自己的执行模型，在普通新会话页选中它语义不明）。归档项目本来就不在 projects 里。
 */
export function selectableProjects(
	projects: readonly ProjectLike[],
	defaultConversationCwd: string,
): readonly ProjectOption[] {
	return projects
		.filter((project) => !project.isDefault && project.type !== "batch" && project.cwd !== defaultConversationCwd)
		.map((project) => ({ cwd: project.cwd, name: project.name ?? basename(project.cwd) }));
}

/**
 * 进页时的默认选中值：从某个项目进来就是该项目，从「对话」或非项目入口进来就是未选中。
 * 路由 cwd 不在可选列表里时（批量任务项目、插件传入的任意目录）仍视为已选中并显示其名字，
 * 只是列表里找不到对应条目——发送目标确实是它，界面不该谎称「未选中」。
 */
export function resolveInitialSelection(input: {
	readonly routeCwd: string;
	readonly defaultConversationCwd: string;
	readonly projects: readonly ProjectLike[];
}): ProjectSelection {
	const { routeCwd, defaultConversationCwd, projects } = input;
	if (!routeCwd || routeCwd === defaultConversationCwd) return null;
	const project = projects.find((candidate) => candidate.cwd === routeCwd);
	if (project?.isDefault) return null;
	return { kind: "project", cwd: routeCwd, name: project?.name ?? basename(routeCwd) };
}

/**
 * 当前选择对应的上下文 cwd：@文件补全、拖拽落点、活动面板与技能列表都用它。
 * 待创建项目在磁盘上还不存在，因此沿用进页时的 cwd，不去指一个尚不存在的目录。
 */
export function resolveContextCwd(input: {
	readonly selection: ProjectSelection;
	readonly routeCwd: string;
	readonly defaultConversationCwd: string;
}): string {
	const { selection, routeCwd, defaultConversationCwd } = input;
	if (selection?.kind === "project") return selection.cwd;
	if (selection?.kind === "pending-create") return routeCwd;
	return defaultConversationCwd || routeCwd;
}

/**
 * 活动面板（文件树等）的根目录，与 {@link resolveContextCwd} 刻意分开：未选中（「对话」）时
 * contextCwd 是 conversation 根——那是所有会话工作区的父目录，把它当文件树根会把内部状态
 * 摆到用户面前；待创建项目在磁盘上还不存在。两者都返回 null，面板走「选择项目」空态。
 */
export function resolveActivityPanelCwd(selection: ProjectSelection): string | null {
	return selection?.kind === "project" ? selection.cwd : null;
}

/** 大小写不敏感的子串匹配：项目名是用户自己取的短名字，模糊匹配只会带来意外命中。 */
export function filterProjects(options: readonly ProjectOption[], query: string): readonly ProjectOption[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return options;
	return options.filter((option) => option.name.toLowerCase().includes(normalized));
}

/** 项目条数超过阈值才给搜索框，条目很少时多一个输入框只是噪音。 */
export function shouldShowSearch(optionCount: number): boolean {
	return optionCount > PROJECT_SEARCH_THRESHOLD;
}

/** ↑↓ 在候选列表里环形移动高亮；列表为空时没有可高亮项。 */
export function moveHighlight(current: number, delta: number, count: number): number {
	if (count <= 0) return -1;
	if (current < 0) return delta > 0 ? 0 : count - 1;
	return (current + delta + count) % count;
}
