import {
	ApprovalRawFallback as ThemeApprovalRawFallback,
	type ApprovalRawFallbackLabels,
} from "@vetta/theme-ui/action-approval";
import { useTranslation } from "react-i18next";

export {
	ApprovalFormField,
	ApprovalImpactCard,
	ApprovalSettingGroup,
	ApprovalSettingRow,
	ApprovalTargetCard,
	ApprovalToggleIntentCard,
	ApprovalValueList,
	ApprovalValueRow,
	ApprovalWarningCard,
} from "@vetta/theme-ui/action-approval";

/** Desktop adapter: inject i18n labels into theme-ui raw fallback. */
export function ApprovalRawFallback({
	input,
	message,
}: {
	input: unknown;
	message?: string;
}): JSX.Element {
	const { t } = useTranslation("common");
	const labels: ApprovalRawFallbackLabels = {
		unreadableRequest: t("actionApproval.unreadableRequest"),
		showTechnicalDetails: t("actionApproval.showTechnicalDetails"),
		hideTechnicalDetails: t("actionApproval.hideTechnicalDetails"),
	};
	return <ThemeApprovalRawFallback input={input} message={message} labels={labels} />;
}
