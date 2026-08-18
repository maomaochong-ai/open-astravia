import { WriteContentView as ThemeWriteContentView } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";
import { getStringArg } from "./shared/parse-tool";

/** Desktop adapter: parse tool block args + inject i18n into props-driven WriteContentView. */
export function WriteContentView({ block }: { block: { args: Record<string, unknown> } }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const content = getStringArg(block.args, "content");
	if (content === null) return null;
	return (
		<ThemeWriteContentView
			content={content}
			label={t("writeContent.label")}
			labels={{
				characterUnit: t("textPreview.characterUnit"),
				emptyLabel: t("textPreview.emptyLabel"),
				lineUnit: t("textPreview.lineUnit"),
			}}
		/>
	);
}
