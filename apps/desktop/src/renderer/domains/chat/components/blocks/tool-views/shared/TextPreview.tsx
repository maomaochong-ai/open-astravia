import {
	TextPreview as ThemeTextPreview,
	type TextPreviewProps as ThemeTextPreviewProps,
} from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

type HostTextPreviewProps = Omit<ThemeTextPreviewProps, "labels">;

/** Desktop adapter: injects i18n labels into props-driven TextPreview. */
export function TextPreview(props: HostTextPreviewProps): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<ThemeTextPreview
			{...props}
			labels={{
				characterUnit: t("textPreview.characterUnit"),
				emptyLabel: t("textPreview.emptyLabel"),
				lineUnit: t("textPreview.lineUnit"),
			}}
		/>
	);
}
