import { ThinkingBlockView as ThemeThinkingBlockView } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

interface ThinkingBlockProps {
	text: string;
	exportMode?: boolean;
	/** 覆盖默认标题（work 模式用「正在思考」）。 */
	title?: string;
	/** work 模式只要一句话，不报行数。 */
	showLineCount?: boolean;
}

export function ThinkingBlockView({
	text,
	exportMode = false,
	title,
	showLineCount = true,
}: ThinkingBlockProps): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<ThemeThinkingBlockView
			text={text}
			exportMode={exportMode}
			labels={{
				title: title ?? t("thinkingBlock.title"),
				lineCount: showLineCount ? (count) => t("thinkingBlock.lineCount", { count }) : undefined,
			}}
		/>
	);
}
