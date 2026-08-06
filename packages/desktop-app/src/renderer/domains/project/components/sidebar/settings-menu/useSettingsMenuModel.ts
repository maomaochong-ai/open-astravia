import { useAuth } from "@domains/auth/hooks/useAuth";
import { useImOnline } from "@shared/hooks/useImOnline";
import { useTheme } from "@shared/hooks/useTheme";
import { loginPopoverOpenAtom, type ThemeMode, themeModeAtom } from "@shared/store/atoms";
import { subscriptionStatusAtom } from "@shared/store/auth-atoms";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsMenuModel, SettingsMenuThemeOption } from "./types";

export function useSettingsMenuModel(open: boolean, setOpen: (open: boolean) => void): SettingsMenuModel {
	const { t } = useTranslation("settings");
	const { t: tProject } = useTranslation("project");
	const mode = useAtomValue(themeModeAtom);
	const { setMode } = useTheme();
	const navigate = useNavigate();
	const setLoginOpen = useSetAtom(loginPopoverOpenAtom);
	const { user, logout } = useAuth();
	const subscription = useAtomValue(subscriptionStatusAtom);
	const clawOnline = useImOnline();

	const goEnabled = subscription.go_enabled;
	const fiveHourWindowRaw = goEnabled ? subscription.windows?.find((window) => window.kind === "5h") : undefined;
	const fiveHourWindow = fiveHourWindowRaw && fiveHourWindowRaw.limit > 0 ? fiveHourWindowRaw : undefined;
	const fiveHourRemainingPercent = fiveHourWindow
		? Math.max(0, Math.min(100, Math.round((1 - fiveHourWindow.consumed / fiveHourWindow.limit) * 100)))
		: 0;
	const themeOptions: SettingsMenuThemeOption[] = [
		{ value: "light", label: t("theme.light"), icon: "icon-[solar--sun-linear]" },
		{ value: "dark", label: t("theme.dark"), icon: "icon-[solar--moon-linear]" },
		{ value: "auto", label: t("theme.system"), icon: "icon-[solar--laptop-linear]" },
	];

	return {
		fiveHourRemainingPercent,
		fiveHourResetAt: fiveHourWindow?.reset_at,
		goBadgeColor: subscription.badge_color,
		goBadgeText: subscription.badge_text,
		goEnabled,
		mode,
		clawOnline,
		clawTitle: tProject("sidebar.clawConnected"),
		open,
		subscriptionTierName: subscription.tier_name,
		themeOptions,
		user,
		actions: {
			login: () => {
				setOpen(false);
				setLoginOpen(true);
			},
			logout: () => {
				setOpen(false);
				logout();
			},
			openSettings: () => {
				setOpen(false);
				void navigate({ to: "/settings/$tab", params: { tab: "account" } });
			},
			setMode: (nextMode: ThemeMode, event: MouseEvent<HTMLButtonElement>) => {
				void setMode(nextMode, {
					x: event.clientX,
					y: event.clientY,
				});
			},
			setOpen,
		},
	};
}

export function useRefreshBillingOnOpen(): (open: boolean, userPresent: boolean) => void {
	const setSubscriptionStatus = useSetAtom(subscriptionStatusAtom);

	return (open: boolean, userPresent: boolean): void => {
		if (!open || !userPresent) return;
		void window.vetta.subscription
			.getStatus()
			.then((result) => {
				if (result.status) setSubscriptionStatus(result.status);
			})
			.catch(console.error);
	};
}
