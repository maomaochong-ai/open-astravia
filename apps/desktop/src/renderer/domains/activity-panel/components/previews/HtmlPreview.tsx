import { HtmlPreviewView } from "@vetta/theme-ui/activity";
import { useTranslation } from "react-i18next";

interface HtmlPreviewProps {
	content: string;
	theme: "light" | "dark";
}

/** Host wrapper: pure HTML render surface (no nested preview/code chrome). */
export function HtmlPreview({ content, theme }: HtmlPreviewProps): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<HtmlPreviewView
			content={content}
			theme={theme}
			title={t("activityPanel.htmlPreview.title")}
		/>
	);
}
