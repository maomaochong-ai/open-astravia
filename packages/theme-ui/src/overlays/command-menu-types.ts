/**
 * Command Menu 的视图契约。
 *
 * 视图层不认识“项目 / 会话 / 设置项”这些业务概念，只认识分组、行、命中区间；
 * 五个数据源的差异全部在宿主的 model 层抹平（见 desktop 的 `domains/command-menu`）。
 */

export interface CommandMenuHighlightRange {
	readonly start: number;
	readonly end: number;
}

export interface CommandMenuItemView {
	/** 稳定 id：选中态锚在它上面，而不是列表下标。 */
	readonly id: string;
	readonly title: string;
	readonly titleHighlights: readonly CommandMenuHighlightRange[];
	readonly subtitle?: string;
	readonly subtitleHighlights?: readonly CommandMenuHighlightRange[];
	/** iconify 类名，例如 `icon-[solar--folder-linear]`。 */
	readonly icon: string;
	readonly badge?: string;
	/** 命中了但当前打不开（例如无权限的会话）：显示但禁用，不静默过滤。 */
	readonly disabled?: boolean;
	readonly disabledReason?: string;
}

export interface CommandMenuGroupView {
	readonly key: string;
	readonly label: string;
	readonly items: readonly CommandMenuItemView[];
	/** 异步源尚未收敛（目前只有会话组会用到）。 */
	readonly loading?: boolean;
	/** 超出每组上限时的提示文案，例如「还有 12 条」。 */
	readonly overflowLabel?: string;
}

export interface CommandMenuViewLabels {
	readonly placeholder: string;
	readonly empty: string;
	readonly emptyHint: string;
	readonly loading: string;
	readonly title: string;
	readonly hintNavigate: string;
	readonly hintSelect: string;
	readonly hintClose: string;
}
