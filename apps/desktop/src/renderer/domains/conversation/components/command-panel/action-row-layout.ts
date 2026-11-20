/**
 * 动作条（命令面板底部）的平铺 / 收起划分。
 *
 * 规则是**固定前 N 个平铺**，不按容器宽度动态算数量：
 *
 * - 宽度驱动的划分会让「同一台机器上窗口拖宽一点，第 3 个按钮就冒出来」，用户刚记住的
 *   位置又变了；更糟的是宽容器下所有按钮平铺、`更多` 被容器查询隐藏，而这一行是
 *   `overflow-x-auto`——非触控屏笔记本上既滚不到右侧、也没有「更多」可点，条目直接够不着。
 * - 固定 2 个 + 常驻「更多」换来的是可预测：第 3 个动作永远在同一个位置能找到。
 */
export const INLINE_ACTION_COUNT = 2;

export interface AddPanelActionRowInput {
	readonly active: boolean;
}

export interface AddPanelActionRowLayout<T> {
	/** 平铺在动作条里的动作。 */
	readonly inline: readonly T[];
	/** 收进「更多」下拉的动作。 */
	readonly overflow: readonly T[];
	/** 是否需要「更多」入口。 */
	readonly hasOverflow: boolean;
	/**
	 * 收起的动作里已激活的数量。
	 *
	 * 触发钮据此打点：动作收进菜单后仍然生效，用户看不见就会以为没开（或以为关不掉）。
	 */
	readonly hiddenActiveCount: number;
}

export function splitActionRow<T extends AddPanelActionRowInput>(
	actions: readonly T[],
	inlineCount: number = INLINE_ACTION_COUNT,
): AddPanelActionRowLayout<T> {
	const limit = Math.max(0, inlineCount);
	if (actions.length <= limit) {
		return { inline: actions, overflow: [], hasOverflow: false, hiddenActiveCount: 0 };
	}
	const inline = actions.slice(0, limit);
	const overflow = actions.slice(limit);
	return {
		inline,
		overflow,
		hasOverflow: true,
		hiddenActiveCount: overflow.filter((action) => action.active).length,
	};
}
