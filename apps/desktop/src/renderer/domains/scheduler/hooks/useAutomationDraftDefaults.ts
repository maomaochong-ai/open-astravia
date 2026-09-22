import { defaultConversationCwdAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AUTOMATION_TEMPLATE_VARIABLES } from "../../../../shared/automation";
import type { AutomationDraftDefaults } from "../automation-draft";

// 默认文案本身就是模板：把每个变量原样代回去，避免 i18next 把 {{name}} 当插值吃掉。
const LITERAL_VARIABLES = Object.fromEntries(AUTOMATION_TEMPLATE_VARIABLES.map((key) => [key, `{{${key}}}`]));

/** 表单默认值：项目默认「对话」，通知文案取当前语言的默认模板。 */
export function useAutomationDraftDefaults(): AutomationDraftDefaults {
	const { t } = useTranslation("automation");
	const conversationCwd = useAtomValue(defaultConversationCwdAtom);
	return useMemo(
		() => ({
			conversationCwd,
			template: t("form.notifyTemplateDefault", { ...LITERAL_VARIABLES, interpolation: { escapeValue: false } }),
			now: Date.now(),
		}),
		[conversationCwd, t],
	);
}
