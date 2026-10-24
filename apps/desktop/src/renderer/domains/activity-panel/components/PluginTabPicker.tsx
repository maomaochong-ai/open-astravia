import { useTranslation } from "react-i18next";
import { DEFAULT_PLUGIN_TAB_ICON, PluginTabPickerView } from "@astravia-org/theme-ui/activity/PluginTabPickerView";
import type { TabPickerEntryView } from "@astravia-org/theme-ui/activity";

export { DEFAULT_PLUGIN_TAB_ICON };

/** "+"下拉里的一个条目：已隐藏的内置 tab、宽度收纳的页签、可添加的插件/内置面板。 */
export type TabPickerEntry = TabPickerEntryView;

interface PluginTabPickerProps {
	/** 当前被隐藏、可点击恢复的 tab（内置/动态） */
	hiddenTabs: TabPickerEntry[];
	/** 恢复（取消隐藏）某个 tab */
	onRestore: (key: string) => void;
	/** 因宽度不足被响应式收纳、未显示在标签栏上的页签（点击激活并自动让其挤回栏内） */
	overflowTabs: TabPickerEntry[];
	/** 激活某个被收纳的页签 */
	onSelectOverflow: (key: string) => void;
	/** 未上栏但可添加的面板（插件未 attach / 内置未添加） */
	availableTabs?: TabPickerEntry[];
	/** 从可添加池挂上栏并激活 */
	onAttachTab?: (key: string) => void;
}

/**
 * 活动面板 tab 栏右侧的下拉：可添加面板、宽度收纳页签、被手动隐藏的页签。
 */
export function PluginTabPicker({
	hiddenTabs,
	onRestore,
	overflowTabs,
	onSelectOverflow,
	availableTabs,
	onAttachTab,
}: PluginTabPickerProps): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<PluginTabPickerView
			hiddenTabs={hiddenTabs}
			onRestore={onRestore}
			overflowTabs={overflowTabs}
			onSelectOverflow={onSelectOverflow}
			availableTabs={availableTabs}
			onAttachTab={onAttachTab}
			labels={{
				menu: t("tabPicker.menu"),
				moreTabs: t("tabPicker.moreTabs"),
				hiddenPanels: t("tabPicker.hiddenPanels"),
				availablePanels: t("tabPicker.availablePanels"),
			}}
		/>
	);
}
