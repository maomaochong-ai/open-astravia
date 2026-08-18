import type { TFunction } from "i18next";

export type ToggleDomain = "mcp" | "skills" | "plugins" | "im" | "webhook" | "general.notifications";

/** 按「将开启 / 将关闭」拆分标题、摘要、确认按钮与影响说明，消除歧义。 */
export function getToggleApprovalCopy(
	t: TFunction<"common">,
	domain: ToggleDomain,
	enabled: boolean,
): {
	title: string;
	summary: string;
	confirm: string;
	impact: string;
	badge: string;
	icon: string;
} {
	const base = `manageApproval.toggleCopy.${domain}` as const;
	if (enabled) {
		return {
			title: t(`${base}.enableTitle`),
			summary: t(`${base}.enableSummary`),
			confirm: t(`${base}.enableConfirm`),
			impact: t(`${base}.enableImpact`),
			badge: t("manageApproval.on"),
			icon: "icon-[mdi--toggle-switch]",
		};
	}
	return {
		title: t(`${base}.disableTitle`),
		summary: t(`${base}.disableSummary`),
		confirm: t(`${base}.disableConfirm`),
		impact: t(`${base}.disableImpact`),
		badge: t("manageApproval.off"),
		icon: "icon-[mdi--toggle-switch-off-outline]",
	};
}

export function getToggleSharedLabels(t: TFunction<"common">): {
	willBecome: string;
	stateOn: string;
	stateOff: string;
	stateOnHint: string;
	stateOffHint: string;
	editableHint: string;
} {
	return {
		willBecome: t("manageApproval.toggle.willBecome"),
		stateOn: t("manageApproval.on"),
		stateOff: t("manageApproval.off"),
		stateOnHint: t("manageApproval.toggle.stateOnHint"),
		stateOffHint: t("manageApproval.toggle.stateOffHint"),
		editableHint: t("manageApproval.toggle.editableHint"),
	};
}
