/**
 * 能力页统一模型：数据源（useAbilityData）+ 操作层（useAbilityActions）+ 搜索过滤。
 * 五种 type 共用同一份条目集合，列表页与详情页都从这里取。
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { useMcpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import { queryAbilityCatalog } from "../lib/ability-catalog-query";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
} from "../lib/build-ability-items";
import {
	ABILITY_CATEGORY_UNCATEGORIZED,
	type AbilitiesModel,
	type AbilityBannerIcon,
	type AbilityGroup,
	type AbilityItem,
	type AbilityScope,
} from "../types";
import { useAbilityActions } from "./useAbilityActions";
import { useAbilityData } from "./useAbilityData";

const ABILITY_PAGE_SIZE = 60;

export function useAbilitiesModel(): AbilitiesModel {
	const { t } = useTranslation("settings");
	const [scope, setScope] = useState<AbilityScope>("discover");
	const [searchQuery, setSearchQuery] = useState("");
	const [visiblePages, setVisiblePages] = useState(1);

	const data = useAbilityData();
	const trPlugin = usePluginTextResolver();
	const mcp = useMcpSettingsModel();
	const actions = useAbilityActions({ mcp, refresh: data.refresh });

	const localState = useMemo<LocalAbilityState>(
		() => ({
			ledger: data.ledger,
			skillManifest: data.skillManifest,
			localSkills: data.localSkills,
			plugins: data.plugins,
			mcpConfig: mcp.config,
			oauthAuthByName: mcp.oauthAuthByName,
			busyIds: actions.busyIds,
		}),
		[
			actions.busyIds,
			data.ledger,
			data.localSkills,
			data.plugins,
			data.skillManifest,
			mcp.config,
			mcp.oauthAuthByName,
		],
	);

	const allItems = useMemo<AbilityItem[]>(() => {
		const singles: AbilityItem[] = [
			...buildSkillAbilities(data.market, localState),
			...buildMcpAbilities(data.market, localState, t),
			...buildPluginAbilities(data.market, localState, trPlugin),
		];
		return [...singles, ...buildBundleAbilities(data.market, singles, localState, t)];
	}, [data.market, localState, t, trPlugin]);

	const changeScope = useCallback((nextScope: AbilityScope) => {
		setScope(nextScope);
		setVisiblePages(1);
	}, []);
	const changeSearchQuery = useCallback((value: string) => {
		setSearchQuery(value);
		setVisiblePages(1);
	}, []);

	const catalogPage = useMemo(
		() =>
			queryAbilityCatalog(allItems, {
				scope,
				keyword: searchQuery,
				page: 1,
				pageSize: visiblePages * ABILITY_PAGE_SIZE,
			}),
		[allItems, scope, searchQuery, visiblePages],
	);
	const items = catalogPage.items;

	const groups = useMemo<AbilityGroup[]>(() => {
		const byCategory = new Map<string, AbilityItem[]>();
		for (const item of items) {
			const key = item.category || ABILITY_CATEGORY_UNCATEGORIZED;
			const bucket = byCategory.get(key);
			if (bucket) bucket.push(item);
			else byCategory.set(key, [item]);
		}
		const uncategorized = byCategory.get(ABILITY_CATEGORY_UNCATEGORIZED);
		byCategory.delete(ABILITY_CATEGORY_UNCATEGORIZED);
		const sorted = Array.from(byCategory.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([category, list]) => ({ category, items: list }));
		return uncategorized ? [...sorted, { category: ABILITY_CATEGORY_UNCATEGORIZED, items: uncategorized }] : sorted;
	}, [items]);

	const bannerIcons = useMemo<AbilityBannerIcon[]>(
		() =>
			allItems.filter((item) => item.fromMarket).map((item) => ({ id: item.id, type: item.type, icon: item.icon })),
		[allItems],
	);

	const findById = useCallback((id: string) => allItems.find((item) => item.id === id) ?? null, [allItems]);

	const errors = useMemo(
		() => Array.from(new Set([data.error, actions.error].filter((value): value is string => Boolean(value)))),
		[actions.error, data.error],
	);

	return {
		scope,
		setScope: changeScope,
		searchQuery,
		setSearchQuery: changeSearchQuery,
		items,
		totalItems: catalogPage.total,
		hasMore: items.length < catalogPage.total,
		loadMore: () => setVisiblePages((current) => current + 1),
		groups,
		allItems,
		bannerIcons,
		loading: data.loading || mcp.config === null,
		refreshing: data.refreshing,
		errors,
		importing: actions.importing,
		mcp,
		findById,
		refresh: data.refresh,
		install: actions.install,
		installBundleMembers: actions.installBundleMembers,
		uninstall: actions.uninstall,
		toggle: actions.toggle,
		setup: (item) => {
			if (item.canConfigure && item.preset) {
				mcp.onConfigureBuiltinSecrets(item.serverName, item.preset);
				return;
			}
			if (item.usesOAuth && !item.authorized) void mcp.onAuthorizeOAuth(item.serverName);
		},
		configure: (item) => mcp.onConfigureBuiltinSecrets(item.serverName, item.preset),
		edit: (item) => mcp.onToggleEditServer(item.serverName),
		revokeAuthorization: (item) => {
			void mcp.onRevokeOAuth(item.serverName);
		},
		setPluginPermission: actions.setPluginPermission,
		setPluginCommand: actions.setPluginCommand,
		reloadPlugin: actions.reloadPlugin,
		uninstallBundleMembers: actions.uninstallMembers,
		importSkillArchive: actions.importSkillArchive,
		startAddManualMcp: () => mcp.onStartAddServer(),
	};
}
