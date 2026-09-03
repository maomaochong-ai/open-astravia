import { activityPanelOpenAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

export interface NewSessionActivityPanelModel {
	/** 右侧活动面板是否展开（与会话页、项目详情页共用同一 atom）。 */
	readonly open: boolean;
	readonly toggle: () => void;
}

/**
 * 新会话页的活动面板开关。
 *
 * 面板展开态是全局 atom，会从上一个会话页/项目页带过来。但「对话」与待创建项目没有可浏览的
 * 根目录（`activityPanelCwd` 为 null），面板只能显示空态——进入这种 scope 时统一收起，
 * 不继承别处记忆的展开态（含窄宽度的展开）。收起只在 scope 变化时发生一次，用户随后
 * 手动展开仍然有效。
 */
export function useNewSessionActivityPanel(activityPanelCwd: string | null): NewSessionActivityPanelModel {
	const [open, setOpen] = useAtom(activityPanelOpenAtom);
	// 只在「有根目录 → 无根目录」以及首次进入无根目录时收起，避免在同一 scope 内反复压掉用户的手动展开。
	const previousCwdRef = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		const previous = previousCwdRef.current;
		previousCwdRef.current = activityPanelCwd;
		if (activityPanelCwd !== null) return;
		if (previous === null) return;
		setOpen(false);
	}, [activityPanelCwd, setOpen]);

	const toggle = useCallback(() => setOpen((value) => !value), [setOpen]);

	return { open, toggle };
}
