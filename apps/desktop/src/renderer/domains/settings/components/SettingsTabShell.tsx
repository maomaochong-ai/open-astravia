import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { settingsTabTitleKey } from "../registry";
import type { SettingsContentTab } from "./settings-tab-loaders";

/**
 * 设置标签 chunk 未就绪时的内容区壳：立刻画出该标签自己的标题，
 * 字号和栏宽跟真实标签页一致，不铺脉冲骨架。
 */
export function SettingsTabShell({ tab }: { tab: SettingsContentTab }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4" aria-busy="true">
			<h1 className="mb-6 text-[20px] font-bold text-foreground">{t(settingsTabTitleKey(tab))}</h1>
		</div>
	);
}
