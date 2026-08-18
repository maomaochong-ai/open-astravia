import { updateProfile } from "@shared/lib/api";
import { authTokenAtom, authUserAtom, subscriptionStatusAtom } from "@shared/store/auth-atoms";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface AccountSettingsModel {
	actions: {
		saveNickname: (nickname: string) => Promise<{ error?: string; ok: boolean }>;
	};
	badge?: {
		color: string;
		text: string;
		title: string;
	};
	displayName?: string;
	labels: {
		cancel: string;
		editNickname: string;
		enterNickname: string;
		pleaseLogin: string;
		save: string;
		saving: string;
	};
	user?: {
		avatar?: string | null;
		email?: string | null;
		nickname?: string | null;
		username: string;
	};
}

export function useAccountSettingsModel(): AccountSettingsModel {
	const { t } = useTranslation("settings");
	const token = useAtomValue(authTokenAtom);
	const [user, setUser] = useAtom(authUserAtom);
	const subscription = useAtomValue(subscriptionStatusAtom);

	const saveNickname = useCallback(
		async (nickname: string): Promise<{ error?: string; ok: boolean }> => {
			const nextNickname = nickname.trim();
			if (!token || !nextNickname) return { ok: false };
			try {
				const updated = await updateProfile(token, { nickname: nextNickname });
				setUser((prev) => (prev ? { ...prev, nickname: updated.nickname } : prev));
				recordSettingsUsage({ tab: "account", action: "saved", target: "nickname" });
				return { ok: true };
			} catch (error) {
				return { error: error instanceof Error ? error.message : t("saveFailed"), ok: false };
			}
		},
		[setUser, t, token],
	);

	const badge =
		subscription.go_enabled && subscription.badge_text
			? {
					color: subscription.badge_color || "var(--primary)",
					text: subscription.badge_text,
					title: subscription.tier_name || "Vetta Go",
				}
			: undefined;

	const labels = useMemo(
		() => ({
			cancel: t("cancel"),
			editNickname: t("editNickname"),
			enterNickname: t("enterNickname"),
			pleaseLogin: t("pleaseLogin"),
			save: t("save"),
			saving: t("saving"),
		}),
		[t],
	);

	return {
		actions: { saveNickname },
		badge,
		displayName: user ? user.nickname || user.username : undefined,
		labels,
		user: user
			? {
					avatar: user.avatar,
					email: user.email,
					nickname: user.nickname,
					username: user.username,
				}
			: undefined,
	};
}
