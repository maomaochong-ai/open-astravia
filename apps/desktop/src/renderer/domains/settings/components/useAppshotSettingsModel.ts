import type { PermissionStatus, PermissionsSnapshot } from "@preload/api";
import type { MacKeyId } from "@shared/components/MacKeyboardPreview";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export type AppshotGestureValue = "both-shift" | "both-mod" | "both-alt";
export type AppshotSelectValue = AppshotGestureValue | "none";

export interface AppshotOptionModel {
	glyph?: string;
	label: string;
	value: AppshotSelectValue;
}

export interface AppshotSettingsModel {
	actions: {
		changeGesture: (next: AppshotSelectValue) => Promise<void>;
		openOnboarding: () => void;
	};
	highlightKeys: MacKeyId[];
	labels: {
		permissionHint: string;
		permissionSectionDescription: string;
		permissions: {
			accessibilityDescription: string;
			accessibilityTitle: string;
			screenDescription: string;
			screenTitle: string;
		};
		sectionPermissions: string;
		sectionShortcut: string;
		setupPermissions: string;
		shortcutDescription: string;
		shortcutTitle: string;
		status: Record<PermissionStatus, string>;
		title: string;
	};
	options: AppshotOptionModel[];
	snapshot: PermissionsSnapshot | null;
	value: AppshotSelectValue;
}

const APPSHOT_OPTIONS = [
	{ value: "both-mod", labelKey: "appshotGestureBothMod" },
	{ value: "both-alt", labelKey: "appshotGestureBothAlt" },
	{ value: "both-shift", labelKey: "appshotGestureBothShift" },
	{ value: "none", labelKey: "appshotGestureNone" },
] as const satisfies ReadonlyArray<{
	labelKey: "appshotGestureBothAlt" | "appshotGestureBothMod" | "appshotGestureBothShift" | "appshotGestureNone";
	value: AppshotSelectValue;
}>;

const APPSHOT_HIGHLIGHT: Record<AppshotGestureValue, MacKeyId[]> = {
	"both-shift": ["shift-left", "shift-right"],
	"both-mod": ["command-left", "command-right"],
	"both-alt": ["option-left", "option-right"],
};

const APPSHOT_GLYPHS: Record<AppshotGestureValue, string> = {
	"both-shift": "⇧",
	"both-mod": "⌘",
	"both-alt": "⌥",
};

function normalizeGesture(value: unknown): AppshotGestureValue {
	return value === "both-mod" || value === "both-alt" ? value : "both-shift";
}

export function useAppshotSettingsModel(): AppshotSettingsModel {
	const { t } = useTranslation("settings");
	const [value, setValue] = useState<AppshotSelectValue>("none");
	const [snapshot, setSnapshot] = useState<PermissionsSnapshot | null>(null);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			const appshot = config.appshot;
			const enabled = appshot?.enabled === true;
			const gesture = normalizeGesture(appshot?.gesture);
			setValue(enabled ? gesture : "none");
		});
	}, []);

	const refreshPermissions = useCallback(async () => {
		try {
			setSnapshot(await window.vetta.permissions.checkAll());
		} catch (err) {
			console.warn("[AppshotSettings] permissions check failed", err);
		}
	}, []);

	useEffect(() => {
		void refreshPermissions();
		const handler = () => void refreshPermissions();
		window.addEventListener("focus", handler);
		return () => window.removeEventListener("focus", handler);
	}, [refreshPermissions]);

	const openOnboarding = useCallback(() => {
		void window.vetta.appshot.openOnboarding();
	}, []);

	const handleChange = useCallback(
		async (next: AppshotSelectValue) => {
			setValue(next);
			await window.vetta.config.set(
				next === "none" ? { appshot: { enabled: false } } : { appshot: { enabled: true, gesture: next } },
			);
			await window.vetta.appshot.reloadGesture();
			recordSettingsUsage({
				tab: "appshot",
				action: next === "none" ? "disabled" : "changed",
				target: "gesture",
				value: next,
			});
			if (next !== "none") {
				const nextSnapshot = await window.vetta.permissions.checkAll().catch(() => null);
				setSnapshot(nextSnapshot);
				if (
					nextSnapshot &&
					(nextSnapshot.accessibility !== "granted" || nextSnapshot.screenRecording !== "granted")
				) {
					openOnboarding();
				}
			}
		},
		[openOnboarding],
	);

	const options = useMemo<AppshotOptionModel[]>(
		() =>
			APPSHOT_OPTIONS.map((option) => {
				if (option.value === "none") {
					return { value: option.value, label: t(option.labelKey) };
				}
				const glyph = APPSHOT_GLYPHS[option.value];
				return { value: option.value, label: t(option.labelKey, { key: glyph }), glyph };
			}),
		[t],
	);

	const labels = useMemo(
		() => ({
			permissionHint: t("appshotPermHint"),
			permissionSectionDescription: t("appshotPermSectionDesc"),
			permissions: {
				accessibilityDescription: t("onboardingPermAccessibilityDesc"),
				accessibilityTitle: t("onboardingPermAccessibility"),
				screenDescription: t("onboardingPermScreenDesc"),
				screenTitle: t("onboardingPermScreen"),
			},
			sectionPermissions: t(SETTINGS_SECTION["appshot-permissions"].titleKey),
			sectionShortcut: t(SETTINGS_SECTION["appshot-gesture"].titleKey),
			setupPermissions: t("appshotSetupPermissions"),
			shortcutDescription: t("appshotShortcutRowDesc"),
			shortcutTitle: t("appshotShortcutRowTitle"),
			status: {
				granted: t("granted"),
				denied: t("denied"),
				unknown: t("unknown"),
			},
			title: t("tabAppshot"),
		}),
		[t],
	);

	return {
		actions: {
			changeGesture: handleChange,
			openOnboarding,
		},
		highlightKeys: value === "none" ? [] : APPSHOT_HIGHLIGHT[value],
		labels,
		options,
		snapshot,
		value,
	};
}
