import { lazy } from "react";
import { useTranslation } from "react-i18next";

import type { ActivityTabDefinition } from "../registry/types";

const BrowserPanel = lazy(() =>
	import("../components/BrowserPanel").then((module) => ({ default: module.BrowserPanel })),
);

function BrowserActivityTab(): JSX.Element {
	return <BrowserPanel />;
}

export const browserTabDefinition: ActivityTabDefinition = {
	id: "browser",
	order: 15,
	removable: true,
	source: "builtin",
	retention: "pinned",
	/**
	 * 默认不上栏：留着地址栏空态也照样能用，所以它进「+」菜单的可添加池，等用户自己添加。
	 * 元数据常驻（不像 todo 那样「没内容就不出现」），否则连菜单里都点不到。
	 */
	initiallyVisible: false,
	useMeta: () => {
		const { t } = useTranslation("chat");
		return {
			label: t("browser.tab"),
			icon: "icon-[mdi--web]",
		};
	},
	component: BrowserActivityTab,
};
