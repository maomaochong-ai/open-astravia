import { useTranslation } from "react-i18next";
import {
	DEFAULT_PLUGIN_TAB_ICON,
	PluginTabPickerView,
	type HiddenTabEntryView,
} from "@vetta/theme-ui/activity";

export { DEFAULT_PLUGIN_TAB_ICON };

/** "+"下拉中可恢复显示的已隐藏内置/动态 tab。 */
export type HiddenTabEntry = HiddenTabEntryView;

interface PluginTabPickerProps {
	/** 当前被隐藏、可点击恢复的 tab（内置/动态） */
	hiddenTabs: HiddenTabEntry[];
	/** 恢复（取消隐藏）某个 tab */
	onRestore: (key: string) => void;
	/** 因宽度不足被响应式收纳、未显示在标签栏上的页签（点击激活并自动让其挤回栏内） */
	overflowTabs: HiddenTabEntry[];
	/** 激活某个被收纳的页签 */
	onSelectOverflow: (key: string) => void;
	/** 已注册但未 attach 的插件 tab */
	availablePluginTabs?: HiddenTabEntry[];
	/** 从可添加池 attach 并激活 */
	onAttachPlugin?: (key: string) => void;
}

/**
 * 活动面板 tab 栏右侧的下拉：可添加池插件 tab、宽度收纳页签、被手动隐藏的页签。
 */
export function PluginTabPicker({
	hiddenTabs,
	onRestore,
	overflowTabs,
	onSelectOverflow,
	availablePluginTabs,
	onAttachPlugin,
}: PluginTabPickerProps): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<PluginTabPickerView
			hiddenTabs={hiddenTabs}
			onRestore={onRestore}
			overflowTabs={overflowTabs}
			onSelectOverflow={onSelectOverflow}
			availablePluginTabs={availablePluginTabs}
			onAttachPlugin={onAttachPlugin}
			labels={{
				menu: t("tabPicker.menu"),
				moreTabs: t("tabPicker.moreTabs"),
				hiddenPanels: t("tabPicker.hiddenPanels"),
				availablePlugins: t("tabPicker.availablePlugins"),
			}}
		/>
	);
}
