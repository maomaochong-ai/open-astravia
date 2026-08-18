import type { DesktopActionApprovalRequest } from "@preload/api.js";
import { useThemeComponent } from "@vetta/theme-sdk";
import { useTranslation } from "react-i18next";
import {
	SETTINGS_SECTIONS,
	SETTINGS_TABS,
	type SettingsSectionRegistration,
	type SettingsTabRegistration,
} from "../../../domains/settings/registry";
import { formatApprovalWhyConfirm, navigationTargetLabel } from "../approvalCopy";
import { useActionApproval } from "../useActionApproval";
import { NavigationOpenApprovalView } from "./NavigationOpenApprovalView";

function isNavigationOpenInput(
	input: DesktopActionApprovalRequest["input"],
): input is { type: "open"; target: string; tab?: string; section?: string } {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
	const record = input as Record<string, unknown>;
	return record.type === "open" && typeof record.target === "string";
}

function settingsTabLabel(
	tab: string,
	tSettings: ReturnType<typeof useTranslation<"settings">>["t"],
): string {
	const registration = (SETTINGS_TABS as readonly SettingsTabRegistration[]).find((item) => item.key === tab);
	if (!registration) return tab;
	// labelKey 来自注册表，用 defaultValue 兜底避免 i18n 严格 key 类型阻拦。
	return tSettings(registration.labelKey, { defaultValue: registration.label });
}

function settingsSectionLabel(
	section: string,
	tSettings: ReturnType<typeof useTranslation<"settings">>["t"],
): string {
	const registration = (SETTINGS_SECTIONS as readonly SettingsSectionRegistration[]).find(
		(item) => item.id === section,
	);
	if (!registration) return section;
	if (!registration.titleKey) return registration.title;
	return tSettings(registration.titleKey, { defaultValue: registration.title });
}

export function NavigationOpenApproval(): JSX.Element | null {
	const { t } = useTranslation("common");
	const { t: tSettings } = useTranslation("settings");
	const approval = useActionApproval("navigation.open");
	const ThemedNavigationOpenApprovalView = useThemeComponent(
		"root.approval.navigationOpenView",
		NavigationOpenApprovalView,
	);
	if (!approval) return null;
	const { request, responding, error, approve, reject } = approval;

	const input = isNavigationOpenInput(request.input) ? request.input : null;
	const fields = input
		? [
				{
					label: t("navigationApproval.target"),
					value: navigationTargetLabel(t, input.target),
				},
				...(input.tab
					? [
							{
								label: t("navigationApproval.tab"),
								value:
									input.target === "settings"
										? settingsTabLabel(input.tab, tSettings)
										: input.tab,
							},
						]
					: []),
				...(input.section
					? [
							{
								label: t("navigationApproval.section"),
								value: settingsSectionLabel(input.section, tSettings),
							},
						]
					: []),
			]
		: [];

	return (
		<ThemedNavigationOpenApprovalView
			countdown={approval.countdown.formatted}
			error={error}
			fallbackJson={input ? null : JSON.stringify(request.input, null, 2)}
			fields={fields}
			impactDescription={t("navigationApproval.impact")}
			impactTitle={t("manageApproval.afterActionTitle")}
			labels={{
				confirm: t("navigationApproval.confirm"),
				permission: formatApprovalWhyConfirm(t, request.permission),
				reject: t("actionApproval.reject"),
				responding: t("navigationApproval.responding"),
				title: t("navigationApproval.title"),
				showTechnicalDetails: t("actionApproval.showTechnicalDetails"),
				hideTechnicalDetails: t("actionApproval.hideTechnicalDetails"),
			}}
			onApprove={() => approve()}
			onReject={reject}
			responding={responding}
			summary={t("navigationApproval.summary")}
		/>
	);
}
