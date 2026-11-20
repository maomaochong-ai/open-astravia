import { activeSessionAtom, promptSuggestionsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface SuggestionBubblesModel {
	suggestions: string[];
	sendTooltip: string;
	/** 「编辑」按钮的提示：把建议填进输入框再改。 */
	editTooltip: string;
}

export function useSuggestionBubblesModel(): SuggestionBubblesModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const suggestionsMap = useAtomValue(promptSuggestionsAtom);
	const suggestions = useMemo(() => {
		const list = activeSession?.runtimeId ? suggestionsMap[activeSession.runtimeId] : undefined;
		return list ?? [];
	}, [activeSession?.runtimeId, suggestionsMap]);

	return {
		suggestions,
		sendTooltip: t("suggestionBubbles.sendTooltip"),
		editTooltip: t("suggestionBubbles.editTooltip"),
	};
}
