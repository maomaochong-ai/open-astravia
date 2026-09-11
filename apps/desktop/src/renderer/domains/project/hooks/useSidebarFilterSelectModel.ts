import {
	conversationTagsAtom,
	type DefaultConversationFilter,
	defaultConversationFilterAtom,
	type SidebarFilter,
	sidebarFilterAtom,
	tagConversationFilter,
} from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const FILTER_OPTIONS = [
	{ value: "all" as const, labelKey: "filterTabs.all" as const },
	{ value: "normal" as const, labelKey: "filterTabs.normal" as const },
	{ value: "batch" as const, labelKey: "filterTabs.batch" as const },
];

export const DEFAULT_CONVERSATION_FILTER_OPTIONS = [
	{ value: "conversation" as const, labelKey: "filterTabs.conversation" as const },
	{ value: "claw" as const, labelKey: "filterTabs.claw" as const },
];

export function useSidebarFilterSelectModel() {
	const { t } = useTranslation("project");
	const [filter, setFilter] = useAtom(sidebarFilterAtom);

	const options = useMemo(
		() =>
			FILTER_OPTIONS.map((option) => ({
				value: option.value,
				label: t(option.labelKey),
				labelKey: option.labelKey,
			})),
		[t],
	);

	const current = options.find((option) => option.value === filter) ?? options[0];

	return {
		current,
		options,
		value: filter as SidebarFilter,
		onChange: setFilter as (value: SidebarFilter) => void,
		showGridIcon: true as const,
	};
}

export function useDefaultConversationFilterSelectModel() {
	const { t } = useTranslation("project");
	const [filter, setFilter] = useAtom(defaultConversationFilterAtom);
	const tags = useAtomValue(conversationTagsAtom);

	// 标签与「对话 / Claw」平级，跟在一条分割线之后；顺序与右键菜单一致（按创建时间）。
	const options = useMemo(
		() => [
			...DEFAULT_CONVERSATION_FILTER_OPTIONS.map((option) => ({
				value: option.value as DefaultConversationFilter,
				label: t(option.labelKey),
			})),
			...tags.tags.map((tag, index) => ({
				value: tagConversationFilter(tag.id),
				label: tag.name,
				dotColor: tag.color,
				separatorBefore: index === 0,
			})),
		],
		[t, tags.tags],
	);

	const current = options.find((option) => option.value === filter) ?? options[0];

	return {
		current,
		options,
		value: filter as DefaultConversationFilter,
		onChange: setFilter as (value: DefaultConversationFilter) => void,
		showGridIcon: false as const,
	};
}
