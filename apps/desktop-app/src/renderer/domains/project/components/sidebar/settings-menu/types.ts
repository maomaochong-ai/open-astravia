import type { ThemeMode } from "@shared/store/atoms";

export interface SettingsMenuThemeOption {
	icon: string;
	label: string;
	value: ThemeMode;
}

export interface SettingsMenuModel {
	fiveHourRemainingPercent: number;
	fiveHourResetAt?: string;
	goBadgeColor?: string;
	goBadgeText?: string;
	goEnabled: boolean;
	mode: ThemeMode;
	/** Claw（IM）是否在线，控制头像 item 内 Claw 状态徽章展示。 */
	clawOnline: boolean;
	/** Claw 徽章 tooltip 文案。 */
	clawTitle: string;
	open: boolean;
	subscriptionTierName?: string;
	themeOptions: SettingsMenuThemeOption[];
	user: {
		avatar?: string | null;
		nickname?: string | null;
		username?: string | null;
	} | null;
	actions: {
		login(): void;
		logout(): void;
		openSettings(): void;
		setMode(mode: ThemeMode, event: React.MouseEvent<HTMLButtonElement>): void;
		setOpen(open: boolean): void;
	};
}
