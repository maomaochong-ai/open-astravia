import { useThemeComponent } from "@vetta/theme-sdk";
import { useTranslation } from "react-i18next";
import { formatApprovalWhyConfirm } from "../approvalCopy";
import { ManageActionApprovalFrameView } from "./ManageActionApprovalFrameView";

/** 领域审批外壳与 i18n；`useActionApproval` 必须只在外层 presenter 调用一次。 */
export function useManageApprovalFrame(): {
	/** Named *Frame so inventory `usesView` matches bare component tags. */
	ManageActionApprovalFrame: typeof ManageActionApprovalFrameView;
	/** @deprecated use ManageActionApprovalFrame */
	Frame: typeof ManageActionApprovalFrameView;
	t: ReturnType<typeof useTranslation<"common">>["t"];
	frameLabels: (
		permission: string,
		confirm: string,
	) => {
		reject: string;
		confirm: string;
		responding: string;
		permission: string;
	};
} {
	const { t } = useTranslation("common");
	const ManageActionApprovalFrame = useThemeComponent("root.approval.manageFrameView", ManageActionApprovalFrameView);
	return {
		ManageActionApprovalFrame,
		Frame: ManageActionApprovalFrame,
		t,
		frameLabels: (permission, confirm) => ({
			reject: t("actionApproval.reject"),
			confirm,
			responding: t("actionApproval.processing"),
			// 不向用户展示 `domain.write` 类权限码，改为说明「为何需要确认」。
			permission: formatApprovalWhyConfirm(t, permission),
		}),
	};
}
