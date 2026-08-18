import {
	CopyButton as ThemeCopyButton,
	formatDuration,
	formatTime,
	RelativeTimeLabel,
} from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

export { formatDuration, formatTime, RelativeTimeLabel };

export function CopyButton({ getText }: { getText: () => string }): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<ThemeCopyButton
			getText={getText}
			labels={{
				copy: t("messageList.copyButton.copy"),
				copied: t("messageList.copyButton.copied"),
			}}
		/>
	);
}
