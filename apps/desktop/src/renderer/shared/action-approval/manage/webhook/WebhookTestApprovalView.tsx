import { WebhookTestApprovalView as ThemeView } from "@vetta/theme-ui/action-approval";
import { useTranslation } from "react-i18next";
import { ManageActionApprovalFrameView } from "../ManageActionApprovalFrameView";
import type { WebhookTestApprovalModel } from "./useWebhookTestApprovalModel";

export function WebhookTestApprovalView(model: WebhookTestApprovalModel): JSX.Element {
	const { t } = useTranslation("common");
	return (
		<ThemeView
			Frame={ManageActionApprovalFrameView}
			{...model}
			rawFallbackLabels={{
				unreadableRequest: t("actionApproval.unreadableRequest"),
				showTechnicalDetails: t("actionApproval.showTechnicalDetails"),
				hideTechnicalDetails: t("actionApproval.hideTechnicalDetails"),
			}}
		/>
	);
}
