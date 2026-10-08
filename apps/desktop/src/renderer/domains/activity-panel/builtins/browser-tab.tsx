import { lazy } from "react";
import { browserUrlByWorkspaceAtom, getBrowserUrlForWorkspace } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

import { useActivityWorkspace } from "../registry/context";
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
	useMeta: () => {
		const { t } = useTranslation("chat");
		const workspace = useActivityWorkspace();
		const browserUrlMap = useAtomValue(browserUrlByWorkspaceAtom);
		const browserUrl = getBrowserUrlForWorkspace(browserUrlMap, workspace.id);
		if (!browserUrl) return null;
		return {
			label: t("browser.tab"),
			icon: "icon-[mdi--web]",
		};
	},
	component: BrowserActivityTab,
};
