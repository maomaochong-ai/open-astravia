import { SendButton as ThemeSendButton, type SendButtonProps as ThemeSendButtonProps } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

export type { SendButtonLabels } from "@vetta/theme-ui/chat";

type HostSendButtonProps = Omit<ThemeSendButtonProps, "labels">;

/** Desktop adapter: injects i18n labels into props-driven SendButton. */
export function SendButton(props: HostSendButtonProps): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<ThemeSendButton
			{...props}
			labels={{
				sendMessage: t("sendButton.sendMessage"),
				stopGenerating: t("sendButton.stopGenerating"),
			}}
		/>
	);
}
