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
	OpenMarketplaceCatalog,
	SkillInfo,
} from "@preload/api";
import { i18n } from "@shared/i18n";
import type { MarketAbility } from "@shared/lib/api";
import { fetchMarketAbilities } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type AbilityMarketSourceState,
	getOpenMarketplaceLoadState,
	shouldReportAbilityLoadFailure,
} from "../lib/ability-load-policy";
import { mergeAbilityCatalogs } from "../lib/merge-ability-catalogs";

export interface AbilityData {
	market: MarketAbility[];
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
}

function isReadonlySkillSource(source: string): boolean {
	return source.startsWith("agents-") || source === "builtin";
}

export function useAbilityData(): AbilityData {
	const token = useAtomValue(authTokenAtom);
	const [serverMarket, setServerMarket] = useState<MarketAbility[]>([]);
	const [openMarketplace, setOpenMarketplace] = useState<OpenMarketplaceCatalog>({
		sources: [],
		snapshots: [],
		abilities: [],
		failedSourceIds: [],
	});
	const [ledger, setLedger] = useState<AbilityLedger>({});
	const [skillManifest, setSkillManifest] = useState<Record<string, InstalledSkill>>({});
	const [localSkills, setLocalSkills] = useState<SkillInfo[]>([]);
	const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
	const [builtinPresentations, setBuiltinPresentations] = useState<BuiltinAbilityPresentations>({});
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
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

			// 市场浏览无需登录；有 token 时仍带上。
			const remote = fetchMarketAbilities(token);
			const open = forceOpenMarketplaceRefresh
				? window.vetta.abilities.refreshOpenMarketplaces()
				: window.vetta.abilities.listOpenMarketplaces();

			// 本地态先落地并结束列表转圈；市场两条在后台合并。
			void local
				.then((value) => {
					if (generation !== loadGenerationRef.current) return;
					const [nextLedger, presentations, manifest, skills, installedPlugins] = value;
					setLedger(nextLedger);
					setBuiltinPresentations(presentations);
					setSkillManifest(manifest);
					setLocalSkills(skills.filter((skill) => isReadonlySkillSource(skill.source)));
					setPlugins(installedPlugins);
				})
				.catch((reason) => {
					if (generation !== loadGenerationRef.current) return;
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
				})
				.catch((reason) => {
					if (generation !== loadGenerationRef.current) return;
					console.warn("Ability server marketplace load failed", reason);
				});

			void open
				.then((value) => {
					if (generation !== loadGenerationRef.current) return;
					setOpenMarketplace(value);
					if (value.failedSourceIds.length > 0) {
						console.warn("Open marketplace sources failed", value.failedSourceIds);
					}
				})
				.catch((reason) => {
					if (generation !== loadGenerationRef.current) return;
					console.warn("Open marketplace catalog load failed", reason);
				});

			void Promise.allSettled([local, remote, open])
				.then(([localResult, remoteResult, openResult]) => {
					if (generation !== loadGenerationRef.current) return;
					const serverState: AbilityMarketSourceState = {
						attempted: true,
						usable: remoteResult.status === "fulfilled",
					};
					const openState: AbilityMarketSourceState =
						openResult.status === "fulfilled"
							? getOpenMarketplaceLoadState(openResult.value)
							: { attempted: true, usable: false };
					setError(
						shouldReportAbilityLoadFailure({
							localFailed: localResult.status === "rejected",
							server: serverState,
							open: openState,
						})
							? i18n.t("abilities:error.loadFailed")
							: null,
					);
				})
				.finally(() => {
					if (generation !== loadGenerationRef.current) return;
					setRefreshing(false);
				});
		},
		[token],
	);

	const refresh = useCallback(() => load(true), [load]);
	const addMarketplaceSource = useCallback(async (input: AddMarketplaceSourceInput): Promise<void> => {
		const source = await window.vetta.abilities.addMarketplaceSource(input);
		try {
			const snapshot = await window.vetta.abilities.refreshMarketplaceSource(source.id);
			setOpenMarketplace((current) => {
				const sources = [...current.sources.filter((item) => item.id !== source.id), source].sort(
					(a, b) => a.priority - b.priority,
				);
				const snapshots = [...current.snapshots.filter((item) => item.sourceId !== source.id), snapshot];
				return {
					sources,
					snapshots,
					abilities: snapshots.flatMap((item) => item.abilities),
					failedSourceIds: current.failedSourceIds.filter((id) => id !== source.id),
				};
			});
		} catch (error) {
			try {
				await window.vetta.abilities.removeMarketplaceSource(source.id);
			} catch (rollbackError) {
				console.warn("Failed to roll back marketplace source", rollbackError);
			}
			throw error;
		}
	}, []);

	useEffect(
		() =>
			window.vetta.abilities.onOpenMarketplacesUpdated(() => {
				void window.vetta.abilities
					.listOpenMarketplaces()
					.then(setOpenMarketplace)
					.catch(() => undefined);
			}),
		[],
	);

	// 内置 skill 的展示文案由主进程按当前语言给出（`skills:builtin.*`），切语言要重新取数。
	const { i18n: i18nInstance } = useTranslation();
	const language = i18nInstance.language;
	useEffect(() => {
		void language;
		load(false);
	}, [load, language]);

	const market = useMemo(
		() => mergeAbilityCatalogs(serverMarket, openMarketplace.snapshots),
		[openMarketplace.snapshots, serverMarket],
	);

	return {
		market,
		ledger,
		skillManifest,
		localSkills,
		plugins,
		builtinPresentations,
		loading,
		refreshing,
		error,
		refresh,
		addMarketplaceSource,
	};
}
