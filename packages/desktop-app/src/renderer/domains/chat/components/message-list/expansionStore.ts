/**
 * 消息列表里所有「展开/收起」态的外置存储。
 *
 * 消息列表跑在 Virtuoso 上：条目展开后变高，一旦超出 overscan 视窗就会被卸载再挂回，
 * 组件内的 `useState` 会随之归零——表现为「点开后又自己折回去」（插件自定义 UI 工具
 * 面板尤其明显，因为它最高）。因此展开态必须活在组件树之外，按稳定 id 记住。
 */

import { atom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useMemo } from "react";

const expandedKeysAtom = atom<Record<string, boolean>>({});

/**
 * 按稳定 key 记住展开态，跨 Virtuoso 卸载/重挂存活。
 *
 * 订阅必须切到单个 key：整张 map 是一个对象，直接 `useAtom` 会让视窗内每一个折叠
 * 组件（每个工具行、每个阶段、每条消息的折叠条、每个错误块）都订阅同一个引用，
 * 点开任意一处就把它们全部重渲染一遍。selectAtom 取出布尔值后按 Object.is 比较，
 * 无关 key 的变化不再触发渲染。
 */
export function useExpansion(key: string, defaultExpanded = false): [boolean, () => void] {
	const valueAtom = useMemo(
		() => selectAtom(expandedKeysAtom, (map) => map[key] ?? defaultExpanded),
		[key, defaultExpanded],
	);
	const expanded = useAtomValue(valueAtom);
	const setMap = useSetAtom(expandedKeysAtom);
	const toggle = useCallback(() => {
		setMap((previous) => ({ ...previous, [key]: !(previous[key] ?? defaultExpanded) }));
	}, [key, defaultExpanded, setMap]);
	return [expanded, toggle];
}
