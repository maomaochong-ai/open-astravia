/**
 * 能力页的原始数据源：市场行 + 安装台账 + 三条安装轨道的本地状态。
 * 只负责取数与刷新，条目组装在 lib/build-ability-items.ts。
 *
 * 首屏策略：本地安装态就绪即结束 loading（列表可出内置/已装项），
 * 服务端市场与开源市场在后台合并，避免网络把整表挡住转圈。
 */
import type {
	AbilityLedger,
	AddMarketplaceSourceInput,
	BuiltinAbilityPresentations,
	InstalledPlugin,
	InstalledSkill,
	MarketplaceSource,
	OpenMarketplaceCatalog,
	SkillInfo,
	UpdateMarketplaceSourceInput,
} from "@preload/api";
import { cloudEnabled } from "@shared/components/cloud-slots";
import { i18n } from "@shared/i18n";
import type { MarketAbility } from "@shared/lib/api";
import { fetchMarketAbilities } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getOpenMarketplaceLoadState, shouldReportAbilityLoadFailure } from "../lib/ability-load-policy";
import { isReadonlyLocalSkillSource } from "../lib/local-skill-source-policy";
import { mergeAbilityCatalogs } from "../lib/merge-ability-catalogs";
import { useOpenMarketplaceData } from "./useOpenMarketplaceData";

export interface AbilityData {
	market: MarketAbility[];
	/** 已配置的 GitHub 市场来源（含内置默认源）。 */
	marketplaceSources: MarketplaceSource[];
	marketplaceCatalog: OpenMarketplaceCatalog;
	refreshMarketplaceSource: (id: string) => Promise<void>;
	ledger: AbilityLedger;
	skillManifest: Record<string, InstalledSkill>;
	/** 通用 Agent / 内置 skill 与 scene（只读展示）。 */
	localSkills: SkillInfo[];
	plugins: InstalledPlugin[];
	builtinPresentations: BuiltinAbilityPresentations;
	loading: boolean;
	refreshing: boolean;
	error: string | null;
	refresh: () => void;
	addMarketplaceSource: (input: AddMarketplaceSourceInput) => Promise<void>;
	updateMarketplaceSource: (id: string, input: UpdateMarketplaceSourceInput) => Promise<void>;
	removeMarketplaceSource: (id: string) => Promise<void>;
}

export function useAbilityData(): AbilityData {
	const token = useAtomValue(authTokenAtom);
	const [serverMarket, setServerMarket] = useState<MarketAbility[]>([]);
	const open = useOpenMarketplaceData();
	const loadOpen = open.load;
	const [serverFailed, setServerFailed] = useState(false);
	const [ledger, setLedger] = useState<AbilityLedger>({});
	const [skillManifest, setSkillManifest] = useState<Record<string, InstalledSkill>>({});
	const [localSkills, setLocalSkills] = useState<SkillInfo[]>([]);
	const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
	const [builtinPresentations, setBuiltinPresentations] = useState<BuiltinAbilityPresentations>({});
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [localFailed, setLocalFailed] = useState(false);
	const loadGenerationRef = useRef(0);

	const load = useCallback(
		(forceOpenMarketplaceRefresh: boolean) => {
			const generation = ++loadGenerationRef.current;
			setRefreshing(true);

			const local = Promise.all([
				window.vetta.abilities.getLedger(),
				window.vetta.abilities.listBuiltinPresentations(),
				window.vetta.skills.getMarketManifest(),
				window.vetta.skills.list(),
				// 能力市场不按工作模式过滤：另一模式下已装的插件仍要出现在「我的」。
				window.vetta.plugins.listAll(),
			]);

			// 市场浏览无需登录；有 token 时仍带上。lite 构建无 vetta 官方市场，
			// 只保留 github 开放市场（openMarketplaces）与本地来源。
			const remote = cloudEnabled ? fetchMarketAbilities(token) : Promise.resolve([]);
			const openResultPromise = loadOpen(forceOpenMarketplaceRefresh);

			// 本地态先落地并结束列表转圈；市场两条在后台合并。
			void local
				.then((value) => {
					if (generation !== loadGenerationRef.current) return;
					const [nextLedger, presentations, manifest, skills, installedPlugins] = value;
					setLocalFailed(false);
					setLedger(nextLedger);
					setBuiltinPresentations(presentations);
					setSkillManifest(manifest);
					setLocalSkills(skills.filter((skill) => isReadonlyLocalSkillSource(skill.source)));
					setPlugins(installedPlugins);
				})
				.catch((reason) => {
					if (generation !== loadGenerationRef.current) return;
					setLocalFailed(true);
					console.warn("Ability local state load failed", reason);
				})
				.finally(() => {
					if (generation !== loadGenerationRef.current) return;
					setLoading(false);
				});

			void remote
				.then((value) => {
					if (generation !== loadGenerationRef.current) return;
					setServerMarket(value);
					setServerFailed(false);
				})
				.catch((reason) => {
					if (generation !== loadGenerationRef.current) return;
					setServerFailed(true);
					console.warn("Ability server marketplace load failed", reason);
				});

			void Promise.allSettled([local, remote, openResultPromise]).finally(() => {
				if (generation !== loadGenerationRef.current) return;
				setRefreshing(false);
			});
		},
		[token, loadOpen],
	);

	const refresh = useCallback(() => load(true), [load]);
	// 内置 skill 的展示文案由主进程按当前语言给出（`skills:builtin.*`），切语言要重新取数。
	const { i18n: i18nInstance } = useTranslation();
	const language = i18nInstance.language;
	useEffect(() => {
		void language;
		load(false);
	}, [load, language]);

	const market = useMemo(
		() => mergeAbilityCatalogs(serverMarket, open.catalog.snapshots),
		[open.catalog.snapshots, serverMarket],
	);

	const error = shouldReportAbilityLoadFailure({
		localFailed,
		server: { attempted: cloudEnabled, usable: cloudEnabled && !serverFailed },
		open: getOpenMarketplaceLoadState(open.catalog),
	})
		? i18n.t("abilities:error.loadFailed")
		: null;

	return {
		market,
		marketplaceSources: open.catalog.sources,
		marketplaceCatalog: open.catalog,
		ledger,
		skillManifest,
		localSkills,
		plugins,
		builtinPresentations,
		loading,
		refreshing: refreshing || open.refreshing,
		error:
			[
				...new Set(
					[error, open.error, serverFailed ? i18n.t("abilities:error.serverFailed") : null].filter(Boolean),
				),
			].join(" / ") || null,
		refresh,
		addMarketplaceSource: open.addSource,
		updateMarketplaceSource: open.updateSource,
		removeMarketplaceSource: open.removeSource,
		refreshMarketplaceSource: open.refreshSource,
	};
}
