import { useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@shared/components/ui/button";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { isMac, isWindows } from "@shared/lib/platform";
import {
	isPersonalModeAtom,
	pageHeaderLeftSlotAtom,
	pageHeaderTitleHiddenAtom,
	type SettingsTab,
} from "@shared/store/atoms";
import { authUserAtom } from "@shared/store/auth-atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { parseWorkspaceViewRef, workspaceViewNavKey } from "../../plugins/runtime/workspace-view-registry";
import { filterVisibleSettingsTabs, findSettingsSection, SETTINGS_TABS } from "../registry";
import type { SettingsNavigationItem, SettingsPageModel } from "./types";
import { useExtensionsSettingsModel } from "./useExtensionsSettingsModel";

export function useSettingsPageModel(): SettingsPageModel {
	const { t } = useTranslation("settings");
	const { t: tCommon } = useTranslation("common");
	const { tab: rawTab } = useParams({ strict: false }) as { tab?: string };
	const search = useSearch({ strict: false }) as Record<string, unknown>;
	const navigate = useNavigate();
	const router = useRouter();
	const isPersonal = useAtomValue(isPersonalModeAtom);
	const authUser = useAtomValue(authUserAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const narrow = useNarrowScreen(1000);
	const highlightingRef = useRef(false);

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	useEffect(() => {
		const back = tCommon("actions.back");
		setHeaderLeftSlot(
			<Button
				variant="ghost"
				size="icon-sm"
				title={back}
				aria-label={back}
				onClick={() => router.history.back()}
			>
				<span className="icon-[mdi--arrow-left] h-4 w-4" />
			</Button>,
		);
		return () => setHeaderLeftSlot(null);
	}, [setHeaderLeftSlot, router, tCommon]);

	const visibleTabRegistrations = useMemo(
		() =>
			filterVisibleSettingsTabs(SETTINGS_TABS, {
				isPersonal,
				hasAuthUser: Boolean(authUser),
				isMac,
				isWindows,
			}),
		[authUser, isPersonal],
	);
	const validTabKeys = useMemo(
		() => new Set(visibleTabRegistrations.map((tab) => tab.key)),
		[visibleTabRegistrations],
	);
	const activeTab: SettingsTab =
		rawTab && validTabKeys.has(rawTab as SettingsTab) ? (rawTab as SettingsTab) : "general";
	const sectionId = getTargetSectionId(search);
	/** 设置壳内嵌打开的插件工作区视图；只有「更多选项」标签下才有意义。 */
	const embeddedView = useMemo(() => {
		const raw = typeof search.view === "string" ? search.view : undefined;
		return raw && activeTab === "extensions" ? (parseWorkspaceViewRef(raw) ?? undefined) : undefined;
	}, [activeTab, search.view]);
	const navigationNonce = typeof search.nav === "string" ? search.nav : undefined;
	const targetSection = sectionId ? findSettingsSection(sectionId) : undefined;

	// MCP 已并入能力页（ADR-0049）；旧 /settings/mcp 与 mcp-* section 深链重定向过去。
	useEffect(() => {
		if (rawTab === "mcp" || targetSection?.tab === "mcp") {
			void navigate({ to: "/abilities", replace: true });
		}
	}, [navigate, rawTab, targetSection]);

	useEffect(() => {
		if (!targetSection || targetSection.tab === activeTab || !validTabKeys.has(targetSection.tab)) {
			return;
		}
		if (targetSection.tab === "mcp") return;
		void navigate({
			to: "/settings/$tab",
			params: { tab: targetSection.tab },
			search: { section: targetSection.id },
		});
	}, [activeTab, navigate, targetSection, validTabKeys]);

	useEffect(() => {
		if (!targetSection || targetSection.tab !== activeTab || highlightingRef.current) return;

		const element = document.getElementById(targetSection.id);
		if (!element) return;

		highlightingRef.current = true;
		element.scrollIntoView({ behavior: "smooth", block: "center" });

		const target =
			document.querySelector<HTMLElement>(
				`[data-setting-section-highlight-target="${targetSection.id}"]`,
			) ??
			(element.closest(".mb-6") as HTMLElement | null) ??
			element;

		const timer = setTimeout(() => {
			target.classList.add("setting-section-breathe");
		}, 500);
		const cleanupTimer = setTimeout(() => {
			target.classList.remove("setting-section-breathe");
			highlightingRef.current = false;
		}, 4100);

		return () => {
			clearTimeout(timer);
			clearTimeout(cleanupTimer);
			target.classList.remove("setting-section-breathe");
			highlightingRef.current = false;
		};
	}, [activeTab, navigationNonce, targetSection]);

	const toNavigationItem = useCallback(
		(tab: (typeof visibleTabRegistrations)[number]): SettingsNavigationItem => {
			const label = t(tab.labelKey);
			return {
				beta: tab.beta,
				icon: tab.icon,
				key: tab.key,
				label,
				title: narrow ? label : undefined,
			};
		},
		[narrow, t],
	);
	// 「更多选项」标签可以就地展开成插件页面清单，省掉一次进页面再选的往返。
	const extensionEntries = useExtensionsSettingsModel().entries;
	const extensionsByKey = useMemo(
		() => new Map(extensionEntries.map((entry) => [entry.key, entry])),
		[extensionEntries],
	);
	const tabs = useMemo<readonly SettingsNavigationItem[]>(
		() =>
			visibleTabRegistrations.map((tab) => {
				const item = toNavigationItem(tab);
				if (tab.key !== "extensions" || extensionEntries.length === 0) return item;
				return {
					...item,
					children: extensionEntries.map((entry) => ({
						key: entry.key,
						label: entry.label,
						icon: entry.icon,
						...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
						title: entry.description || entry.pluginName,
					})),
				};
			}),
		[extensionEntries, toNavigationItem, visibleTabRegistrations],
	);

	return {
		activeTab,
		embeddedView,
		onSelectNavigationChild: (key) => extensionsByKey.get(key)?.open(),
		activeNavigationChildKey: embeddedView
			? workspaceViewNavKey(embeddedView.pluginId, embeddedView.viewId)
			: undefined,
		onCloseEmbeddedView: () => {
			void navigate({ to: "/settings/$tab", params: { tab: "extensions" }, search: {} });
		},
		betaBadgeLabel: t("betaBadge"),
		narrow,
		onSelectTab: (tab) => {
			// 显式落到标签本身：从内嵌的插件视图切回设置项时要把 `view` 清掉。
			void navigate({ to: "/settings/$tab", params: { tab }, search: {} });
		},
		tabs,
		title: t("title"),
	};
}

function getTargetSectionId(search: Record<string, unknown>): string | undefined {
	if (typeof search.section === "string") return search.section;
	if (typeof search.h2 === "string") return search.h2;
	return undefined;
}
