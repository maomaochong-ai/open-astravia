import { CopyIconButton as ThemeCopyIconButton } from "@vetta-org/theme-ui/chat/CopyIconButton";
import type { CopyIconButtonProps as ThemeCopyIconButtonProps } from "@vetta-org/theme-ui/chat";
import { useTranslation } from "react-i18next";

type HostCopyIconButtonProps = Omit<ThemeCopyIconButtonProps, "labels">;

/** Desktop adapter: injects i18n labels into props-driven CopyIconButton. */
export function CopyIconButton(props: HostCopyIconButtonProps): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<ThemeCopyIconButton
			{...props}
			labels={{
				label: t("copyButton.label"),
				copied: t("copyButton.copied"),
			}}
		/>
	);
}
