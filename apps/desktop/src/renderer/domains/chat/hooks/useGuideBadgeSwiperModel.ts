import { useNavigate } from "@tanstack/react-router";
import type { GuideBadgeSwiperViewProps, GuideBadgeViewItem } from "@vetta/theme-ui/chat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// 引导 badge：常驻(persistent)无法关闭；首次(once)关闭后本地持久化，以后不再展示。
type GuideBadgeType = "persistent" | "once";

interface GuideBadge {
	id: string;
	type: GuideBadgeType;
	icon: string;
	text: string;
	onClick: () => void;
}

// 首次类 badge 关闭后写入此 localStorage key（JSON 字符串数组），下次启动据此过滤。
const DISMISSED_KEY = "vetta-guide-badges-dismissed";
// 自动轮播间隔。
const ROTATE_INTERVAL = 5000;

function loadDismissed(): Set<string> {
	try {
		const raw = localStorage.getItem(DISMISSED_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw) as unknown;
		return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
	} catch {
		return new Set();
	}
}

function persistDismissed(ids: Set<string>): void {
	try {
		localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
	} catch {
		// localStorage 不可用时静默降级：本次会话内仍按已关闭处理。
	}
}

export type GuideBadgeSwiperModel = GuideBadgeSwiperViewProps | null;

export function useGuideBadgeSwiperModel(mounted: boolean): GuideBadgeSwiperModel {
	const { t } = useTranslation("chat");
	const navigate = useNavigate();
	const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
	const [index, setIndex] = useState(0);

	const allBadges = useMemo<GuideBadge[]>(
		() => [
			{
				id: "pet-feature",
				type: "once",
				icon: "icon-[mdi--paw-outline]",
				text: t("guideBadgeSwiper.petFeatureText"),
				onClick: () => void navigate({ to: "/settings/$tab", params: { tab: "pet" } }),
			},
			{
				id: "quick-panel-feature",
				type: "once",
				icon: "icon-[solar--magnifer-linear]",
				text: t("guideBadgeSwiper.quickPanelText"),
				onClick: () =>
					void navigate({
						to: "/settings/$tab",
						params: { tab: "shortcuts" },
						search: { section: "shortcuts-quickpanel" },
					}),
			},
		],
		[navigate, t],
	);

	const badges = useMemo(
		() => allBadges.filter((b) => b.type === "persistent" || !dismissed.has(b.id)),
		[allBadges, dismissed],
	);

	useEffect(() => {
		setIndex((i) => (badges.length === 0 ? 0 : i % badges.length));
	}, [badges.length]);

	useEffect(() => {
		if (badges.length <= 1) return;
		const id = window.setInterval(() => setIndex((i) => (i + 1) % badges.length), ROTATE_INTERVAL);
		return () => window.clearInterval(id);
	}, [badges.length]);

	const handleDismiss = useCallback((badgeId: string) => {
		setDismissed((prev) => {
			const next = new Set(prev);
			next.add(badgeId);
			persistDismissed(next);
			return next;
		});
	}, []);

	if (badges.length === 0) return null;
	const current = badges[index % badges.length];
	const item: GuideBadgeViewItem = {
		id: current.id,
		icon: current.icon,
		text: current.text,
		dismissible: current.type === "once",
		onClick: current.onClick,
	};

	return {
		mounted,
		current: item,
		labels: {
			dismissTooltip: t("guideBadgeSwiper.dismissTooltip"),
		},
		onDismiss: handleDismiss,
	};
}
