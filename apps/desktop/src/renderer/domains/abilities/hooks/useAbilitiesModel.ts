/**
 * 能力页统一模型：数据源（useAbilityData）+ 操作层（useAbilityActions）+ 搜索过滤。
 * 五种 type 共用同一份条目集合，列表页与详情页都从这里取。
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { useMcpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import {
	countAbilitiesByType,
	filterAbilityCatalog,
	isAbilityListedInDiscover,
	queryAbilityCatalog,
} from "../lib/ability-catalog-query";
import { localizeMarketAbility } from "../lib/ability-presentation";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
} from "../lib/build-ability-items";
import { decorateAbilityConflicts } from "../lib/decorate-ability-conflicts";
import { groupAbilities } from "../lib/group-abilities";
import { withLocalAbilityPresentation } from "../lib/local-ability-presentation";
import {
	type AbilitiesModel,
	type AbilityBannerIcon,
	type AbilityFilter,
	type AbilityGroup,
	type AbilityItem,
	type AbilityScope,
	EMPTY_ABILITY_FILTER,
	type McpAbility,
} from "../types";
import { useAbilityActions } from "./useAbilityActions";
import { useAbilityData } from "./useAbilityData";

const ABILITY_PAGE_SIZE = 60;

export interface UseAbilitiesModelOptions {
	/** 深链带进来的搜索词初值；只播种一次，之后由页面状态接管。 */
	readonly initialSearchQuery?: string;
	/** 深链指定的落地分区；缺省仍是「发现」。 */
	readonly initialScope?: AbilityScope;
}

export function useAbilitiesModel(options: UseAbilitiesModelOptions = {}): AbilitiesModel {
	const { t, i18n } = useTranslation("settings");
	const [scope, setScope] = useState<AbilityScope>(options.initialScope ?? "discover");
	const [searchQuery, setSearchQuery] = useState(options.initialSearchQuery ?? "");
	const [filter, setFilter] = useState<AbilityFilter>(EMPTY_ABILITY_FILTER);
	const [visiblePages, setVisiblePages] = useState(1);

	const data = useAbilityData();
	const trPlugin = usePluginTextResolver();
	// 引导弹窗里完成的安装不走 useAbilityActions，台账要由 mcp 模型回调刷新，
	// 否则卡片继续显示「添加」，再点一次就会装出第二个同名 server。
	const mcp = useMcpSettingsModel({ onAbilityLedgerChanged: data.refresh });
	const actions = useAbilityActions({
		mcp,
		refresh: data.refresh,
		refreshLocalInstallState: data.refreshLocalInstallState,
	});

	const localState = useMemo<LocalAbilityState>(
		() => ({
			ledger: data.ledger,
			mcpSetupStatus: data.mcpSetupStatus,
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
			data.mcpSetupStatus,
			data.plugins,
			data.skillManifest,
			mcp.config,
			mcp.oauthAuthByName,
		],
	);

	// 市场行先按界面语言归一（name / description / tags 取 detail.i18n[locale] 覆盖），
	// 再喂给组装函数：卡片、搜索词、分组、详情页头部由此一并跟随语言。
	const market = useMemo(
		() => data.market.map((entry) => localizeMarketAbility(entry, i18n.language)),
		[data.market, i18n.language],
	);

	const allItems = useMemo<AbilityItem[]>(() => {
		const singles = [
			...buildSkillAbilities(market, localState),
			...buildMcpAbilities(market, localState, t),
			...buildPluginAbilities(market, localState, trPlugin),
		]
			.map((item) => withLocalAbilityPresentation(item, data.localPresentations))
			.map((item) => ({
				...item,
				operation: actions.operationById.get(item.id),
				operationProgress: actions.operationProgressById.get(item.id),
			}));
		return decorateAbilityConflicts([...singles, ...buildBundleAbilities(market, singles, localState, t)]).map(
			(item) => ({
				...item,
				operation: actions.operationById.get(item.id),
				operationProgress: actions.operationProgressById.get(item.id),
			}),
		);
	}, [market, localState, t, trPlugin, data.localPresentations, actions.operationById, actions.operationProgressById]);

	const changeScope = useCallback((nextScope: AbilityScope) => {
		setScope(nextScope);
		// 「个人」没有来源维度：切换分区时清掉来源，类型筛选跨分区保留。
		setFilter((current) => (current.provenance === "all" ? current : { ...current, provenance: "all" }));
		setVisiblePages(1);
	}, []);
	const changeSearchQuery = useCallback((value: string) => {
		setSearchQuery(value);
		setVisiblePages(1);
	}, []);
	const changeFilter = useCallback((next: AbilityFilter) => {
		setFilter(next);
		setVisiblePages(1);
	}, []);

	// 类型计数不受类型筛选本身影响，否则勾掉一个类型后它的数量就归零、无从判断要不要再勾回来。
	const typeCounts = useMemo(
		() =>
			countAbilitiesByType(
				filterAbilityCatalog(allItems, { scope, keyword: searchQuery, provenance: filter.provenance }),
			),
		[allItems, scope, searchQuery, filter.provenance],
	);

	const catalogPage = useMemo(
		() =>
			queryAbilityCatalog(allItems, {
				scope,
				keyword: searchQuery,
				types: filter.types,
				provenance: filter.provenance,
				page: 1,
				pageSize: visiblePages * ABILITY_PAGE_SIZE,
			}),
		[allItems, scope, searchQuery, filter, visiblePages],
	);
	const items = catalogPage.items;

	const groups = useMemo<AbilityGroup[]>(() => groupAbilities(items), [items]);

	const bannerIcons = useMemo<AbilityBannerIcon[]>(
		() =>
			allItems
				.filter((item) => item.fromMarket && isAbilityListedInDiscover(item))
				.map((item) => ({ id: item.id, type: item.type, icon: item.icon })),
		[allItems],
	);

	const findById = useCallback(
		(id: string) => {
			const exact = allItems.find((item) => item.id === id);
			if (exact) return exact;
			const separator = id.indexOf(":");
			if (separator < 1) return null;
			const type = id.slice(0, separator);
			const slug = id.slice(separator + 1);
			const legacyMatches = allItems.filter((item) => item.type === type && item.slug === slug);
			return (
				legacyMatches.find((item) => item.installed) ??
				legacyMatches.find((item) => item.catalogSource.kind === "server") ??
				legacyMatches[0] ??
				null
			);
		},
		[allItems],
	);

	const errors = useMemo(
		() => Array.from(new Set([data.error, actions.error].filter((value): value is string => Boolean(value)))),
		[actions.error, data.error],
	);
	const detailErrors = useMemo(() => (actions.error ? [actions.error] : []), [actions.error]);

	// 卡片是长列表的行组件，靠 `memo` 跳过没变的行；回调每次渲染都新建就会把 memo 全部打穿，
	// 于是每敲一个字、每完成一个操作都要重渲整页（市场装得越多越卡）。
	// `actions` / `mcp` 是每次渲染新建的对象字面量，直接依赖它们会让下面的 useCallback
	// 每次失效，行组件的 memo 也就跟着全部打穿。只引用其中稳定的具体回调。
	const { promptMcpSetup } = actions;
	const { onAuthorizeOAuth, onConfigureBuiltinSecrets, onRevokeOAuth, onToggleEditServer } = mcp;
	const setupAbility = useCallback(
		(item: McpAbility) => {
			// 安装后步骤（扫码登录等）不在客户端完成，只能把做法讲清楚。
			if (item.postInstallSetup) {
				promptMcpSetup(item);
				return;
			}
			if (item.canConfigure && item.preset) {
				onConfigureBuiltinSecrets(item.serverName, item.preset);
				return;
			}
			if (item.usesOAuth && !item.authorized) void onAuthorizeOAuth(item.serverName);
		},
		[promptMcpSetup, onConfigureBuiltinSecrets, onAuthorizeOAuth],
	);
	const configureAbility = useCallback(
		(item: McpAbility) => {
			// 声明了安装后步骤的能力，「配置」就是去完成那一步（扫码），
			// 可选参数留给「编辑配置」，不要再把用户送进一个与登录无关的凭证表单。
			if (item.postInstallSetup) {
				promptMcpSetup(item);
				return;
			}
			onConfigureBuiltinSecrets(item.serverName, item.preset);
		},
		[promptMcpSetup, onConfigureBuiltinSecrets],
	);
	const editAbility = useCallback((item: McpAbility) => onToggleEditServer(item.serverName), [onToggleEditServer]);
	const revokeAbilityAuthorization = useCallback(
		(item: McpAbility) => {
			void onRevokeOAuth(item.serverName);
		},
		[onRevokeOAuth],
	);

	return {
		scope,
		setScope: changeScope,
		searchQuery,
		setSearchQuery: changeSearchQuery,
		filter,
		setFilter: changeFilter,
		typeCounts,
		items,
		totalItems: catalogPage.total,
		hasMore: items.length < catalogPage.total,
		loadMore: () => setVisiblePages((current) => current + 1),
		groups,
		allItems,
		bannerIcons,
		// mcpConfig 缺省时 buildMcpAbilities 按空表处理，不必再挡整表转圈。
		loading: data.loading,
		refreshing: data.refreshing,
		errors,
		detailErrors,
		importing: actions.importing,
		mcp,
		findById,
		refresh: data.refresh,
		refreshLocalInstallState: data.refreshLocalInstallState,
		install: actions.install,
		installBundleMembers: actions.installBundleMembers,
		uninstall: actions.uninstall,
		toggle: actions.toggle,
		setup: setupAbility,
		configure: configureAbility,
		edit: editAbility,
		revokeAuthorization: revokeAbilityAuthorization,
		setPluginPermission: actions.setPluginPermission,
		applyPluginSetup: actions.applyPluginSetup,
		setPluginCommand: actions.setPluginCommand,
		reloadPlugin: actions.reloadPlugin,
		uninstallBundleMembers: actions.uninstallMembers,
		importSkillArchive: actions.importSkillArchive,
		importPluginArchive: actions.importPluginArchive,
		addMarketplaceSource: data.addMarketplaceSource,
		updateMarketplaceSource: data.updateMarketplaceSource,
		removeMarketplaceSource: data.removeMarketplaceSource,
		clearMarketplaceSourceCredential: data.clearMarketplaceSourceCredential,
		marketplaceSources: data.marketplaceSources,
		marketplaceCatalog: data.marketplaceCatalog,
		refreshMarketplaceSource: data.refreshMarketplaceSource,
		startAddManualMcp: () => mcp.onStartAddServer(),
		permissionPromptSlug: actions.permissionPromptSlug,
		pendingPluginSetup: actions.pendingPluginSetup,
		dismissPermissionPrompt: actions.dismissPermissionPrompt,
		setupPromptId: actions.setupPromptId,
		dismissSetupPrompt: actions.dismissSetupPrompt,
	};
}
