import { useCallback, useState } from "react";

/**
 * 画布备注气泡的显隐。
 *
 * 只有用户手动能隐藏：自动规则一律只往「显示」推（切到备注工具、创建了一条备注、
 * 从备注列表定位到某条）。否则刚落下的备注会因为之前随手关过一次而不见踪影，
 * 用户根本不知道东西去哪了。
 */
export interface NotesVisibility {
	visible: boolean;
	/** 自动显示：只开不关，已经显示时是空操作。 */
	show(): void;
	/** 顶栏开关：唯一能隐藏的入口。 */
	toggle(): void;
}

export function useNotesVisibility(): NotesVisibility {
	const [visible, setVisible] = useState(true);
	const show = useCallback(() => setVisible(true), []);
	const toggle = useCallback(() => setVisible((value) => !value), []);
	return { visible, show, toggle };
}
