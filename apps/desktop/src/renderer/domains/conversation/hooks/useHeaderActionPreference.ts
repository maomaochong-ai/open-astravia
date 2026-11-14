import type { HeaderActionItem } from "@astravia-org/theme-ui/chat/HeaderActionGroupView";
import {
	applyHeaderActionOrder,
	EMPTY_HEADER_ACTION_PREFERENCE,
	HEADER_ACTIONS_STORAGE_KEY,
	type HeaderActionPreference,
	parseHeaderActionPreference,
	serializeHeaderActionPreference,
} from "@domains/conversation/services/header-action-preference";
import { useCallback, useMemo, useState } from "react";

/**
 * 顶栏动作的顺序与显示偏好。
 *
 * 只在本地保存（`astravia-header-actions`），与其它本地偏好的做法一致：这是「我这台
 * 机器上习惯怎么用」，不需要跨设备同步，也不该进桌面配置文件。
 *
 * `visible` 是最终交给顶栏渲染的列表：用户排过顺序的在前、新出现的动作接在后面、
 * 用户主动隐藏的不进胶囊（仍可在调整模式里恢复）。
 */
export interface UseHeaderActionPreferenceResult {
	readonly items: readonly HeaderActionItem[];
	readonly editing: boolean;
	readonly setEditing: (next: boolean) => void;
	readonly hiddenIds: readonly string[];
	readonly reorder: (order: readonly string[]) => void;
	readonly toggleVisibility: (id: string) => void;
}

function readStoredPreference(): HeaderActionPreference {
	if (typeof localStorage === "undefined") return EMPTY_HEADER_ACTION_PREFERENCE;
	try {
		return parseHeaderActionPreference(localStorage.getItem(HEADER_ACTIONS_STORAGE_KEY) ?? undefined);
	} catch {
		return EMPTY_HEADER_ACTION_PREFERENCE;
	}
}

function writeStoredPreference(preference: HeaderActionPreference): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(HEADER_ACTIONS_STORAGE_KEY, serializeHeaderActionPreference(preference));
	} catch {
		// 存储不可用（隐私模式、配额满）时只是本次不持久化，界面照常工作。
	}
}

export function useHeaderActionPreference(defaultItems: readonly HeaderActionItem[]): UseHeaderActionPreferenceResult {
	const [preference, setPreference] = useState<HeaderActionPreference>(readStoredPreference);
	const [editing, setEditing] = useState(false);

	const items = useMemo(() => {
		const ordered = applyHeaderActionOrder(defaultItems, preference.order);
		return ordered.filter((item) => !preference.hidden.includes(item.id));
	}, [defaultItems, preference]);

	const update = useCallback((next: HeaderActionPreference) => {
		setPreference(next);
		writeStoredPreference(next);
	}, []);

	const reorder = useCallback(
		(order: readonly string[]) => {
			// 拖动结果是完整顺序（含新出现的动作），直接采用并持久化。
			update({ ...preference, order: [...order] });
		},
		[preference, update],
	);

	const toggleVisibility = useCallback(
		(id: string) => {
			const hidden = preference.hidden.includes(id)
				? preference.hidden.filter((entry) => entry !== id)
				: [...preference.hidden, id];
			update({ ...preference, hidden });
		},
		[preference, update],
	);

	return { items, editing, setEditing, hiddenIds: preference.hidden, reorder, toggleVisibility };
}
