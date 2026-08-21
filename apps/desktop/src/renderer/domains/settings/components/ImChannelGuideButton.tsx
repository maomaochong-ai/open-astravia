import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";

/** 各渠道配置对话框头部的「使用说明」入口，样式统一在这里。 */
export function ImChannelGuideButton({ onOpen }: { onOpen: () => void }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<Button variant="ghost" size="sm" className="shrink-0 text-[12px] text-muted-foreground" onClick={onOpen}>
			<span className="icon-[mdi--help-circle-outline] mr-1 h-3.5 w-3.5" />
			{t("imGuideOpen")}
		</Button>
	);
}
