import { useTranslation } from "react-i18next";
import type { SettingsAiAssistTabId } from "./catalog";
import { SettingsAiAssistDialog } from "./SettingsAiAssistDialog";
import { useSettingsAiAssist } from "./useSettingsAiAssist";

export interface SettingsAiAssistProps {
	tabId: SettingsAiAssistTabId;
	className?: string;
}

/**
 * Settings-page entry: compact CTA + intent popover → background conversation with a structured
 * starter prompt. Does not auto-navigate to chat; a fly-orb cue points at the new sidebar session.
 * Write ops still go through vetta action approval after the agent runs.
 */
export function SettingsAiAssist({ tabId, className }: SettingsAiAssistProps): JSX.Element | null {
	const { t } = useTranslation("settings");
	const model = useSettingsAiAssist(tabId);

	if (!model) return null;

	const contextLabel = t(model.entry.contextLabelKey);
	const examples = model.entry.exampleKeys.map((key) => t(key));
	const placeholder = t(model.entry.placeholderKey);

	return (
		<SettingsAiAssistDialog
			className={className}
			open={model.dialogOpen}
			triggerLabel={t("aiAssist.cta")}
			contextLabel={contextLabel}
			examples={examples}
			intent={model.intent}
			placeholder={placeholder}
			submitError={model.submitError}
			onApplyExample={model.applyExample}
			onIntentChange={model.setIntent}
			onOpenChange={(open) => {
				if (open) model.openDialog();
				else model.closeDialog();
			}}
			onSubmit={(originRect) => void model.submit(originRect)}
		/>
	);
}
