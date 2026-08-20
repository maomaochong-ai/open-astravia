import { cloudEnabled } from "@shared/components/cloud-slots";
import { useImOnline } from "@shared/hooks/useImOnline";
import { useTheme } from "@shared/hooks/useTheme";
import { authUserAtom, loginPopoverOpenAtom, type ThemeMode, themeModeAtom } from "@shared/store/atoms";
import { cloudLogoutAtom, subscriptionStatusAtom } from "@shared/store/auth-atoms";
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
	// 不再经 useAuth 取登录态：那个 hook 同时挂载整套云会话 effects，属于
	// App 根部 <CloudAuthBoot /> 的职责；这里只读原子状态 + 写登出 atom。
	const user = useAtomValue(authUserAtom);
	const logout = useSetAtom(cloudLogoutAtom);
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
		cloudEnabled,
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

/**
 * 打开设置菜单时顺带补一次更新检查：这是用户最可能注意到「有新版本」的时机，
 * 也是长期不退出应用的用户与周期性重查之外的第二条同步入口。节流与忙碌判断
 * 都在主进程（见 UpdaterService.syncInBackground），这里不做 UI 忙碌态。
 */
export function useSyncUpdateOnOpen(): (open: boolean) => void {
	return (open: boolean): void => {
		if (!open) return;
		void window.vetta.updater.sync().catch(console.error);
	};
}
