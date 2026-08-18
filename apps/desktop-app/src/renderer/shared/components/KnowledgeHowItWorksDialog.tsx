import { useTranslation } from "react-i18next";
import { KnowledgeHowItWorksDialogView } from "@vetta/theme-ui/knowledge";

interface KnowledgeHowItWorksDialogProps {
	open: boolean;
	onClose: () => void;
}

const STEPS = [
	{
		icon: "icon-[mdi--folder-plus-outline]",
		titleKey: "kbHiwStep1Title",
		descKey: "kbHiwStep1Desc",
	},
	{
		icon: "icon-[mdi--robot-outline]",
		titleKey: "kbHiwStep2Title",
		descKey: "kbHiwStep2Desc",
	},
	{
		icon: "icon-[mdi--chat-question-outline]",
		titleKey: "kbHiwStep3Title",
		descKey: "kbHiwStep3Desc",
	},
] as const;

export function KnowledgeHowItWorksDialog({
	open,
	onClose,
}: KnowledgeHowItWorksDialogProps): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<KnowledgeHowItWorksDialogView
			open={open}
			onClose={onClose}
			steps={STEPS.map((step) => ({
				icon: step.icon,
				title: t(step.titleKey),
				description: t(step.descKey),
			}))}
			labels={{
				title: t("kbHiwTitle"),
				subtitle: t("kbHiwSubtitle"),
				whyTitle: t("kbHiwWhyTitle"),
				whyDesc: t("kbHiwWhyDesc"),
			}}
		/>
	);
}
