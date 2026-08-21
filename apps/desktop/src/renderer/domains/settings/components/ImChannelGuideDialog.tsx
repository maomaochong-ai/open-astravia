import type { ImTransportSelector } from "@preload/api";
import { ImChannelGuideDialogView } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { getImChannelGuide } from "./im-channel-guides";

/**
 * 渠道使用手册的二级弹窗：由各渠道配置对话框头部的「使用说明」打开，
 * 内容来自 im-channel-guides 注册表。
 */
export function ImChannelGuideDialog({
	transport,
	onClose,
}: {
	/** null 表示不展示；非 null 即打开对应渠道的手册。 */
	transport: ImTransportSelector | null;
	onClose: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	if (!transport) return null;
	const guide = getImChannelGuide(transport);

	return (
		<ImChannelGuideDialogView
			open
			onClose={onClose}
			steps={guide.steps.map((step) => ({
				icon: step.icon,
				title: t(step.titleKey),
				description: t(step.descKey),
				// `code` 只有部分步骤有，收窄后再取。
				code: "code" in step ? step.code : undefined,
			}))}
			notes={guide.notes.map((note) => ({
				tone: note.tone,
				title: t(note.titleKey),
				description: t(note.descKey),
			}))}
			labels={{
				title: t(guide.titleKey),
				subtitle: t(guide.subtitleKey),
				close: t("imGuideClose"),
			}}
		/>
	);
}
