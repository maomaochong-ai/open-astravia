import { pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { useAutomationPageModel } from "../hooks/useAutomationPageModel";
import { AutomationPageView } from "./AutomationPageView";

export function AutomationPage(): JSX.Element {
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);

	// 「让 Vetta 帮您配置」放在标题栏右上角，与知识库等页面一致，不挤占列表区。
	useEffect(() => {
		setHeaderRightSlot(<SettingsAiAssist tabId="automation" />);
		return () => setHeaderRightSlot(null);
	}, [setHeaderRightSlot]);

	return <AutomationPageView {...useAutomationPageModel()} />;
}
