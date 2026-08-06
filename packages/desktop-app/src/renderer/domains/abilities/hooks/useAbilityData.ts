/**
 * 能力页的原始数据源：市场行 + 安装台账 + 三条安装轨道的本地状态。
 * 只负责取数与刷新，条目组装在 lib/build-ability-items.ts。
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { areAllAttemptedMarketSourcesUnavailable, getOpenMarketplaceLoadState } from "../lib/ability-load-policy";
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

	const load = useCallback(
		(forceOpenMarketplaceRefresh: boolean) => {
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

			void Promise.allSettled([local, remote, open])
				.then(([localResult, remoteResult, openResult]) => {
					const errors: string[] = [];
					if (localResult.status === "fulfilled") {
						const [nextLedger, presentations, manifest, skills, installedPlugins] = localResult.value;
						setLedger(nextLedger);
						setBuiltinPresentations(presentations);
						setSkillManifest(manifest);
						setLocalSkills(skills.filter((skill) => isReadonlySkillSource(skill.source)));
						setPlugins(installedPlugins);
					} else {
						console.warn("Ability local state load failed", localResult.reason);
						errors.push(i18n.t("abilities:error.loadFailed"));
					}
					const serverState = {
						attempted: true,
						usable: remoteResult.status === "fulfilled",
					};
					if (remoteResult.status === "fulfilled") {
						setServerMarket(remoteResult.value);
					} else {
						console.warn("Ability server marketplace load failed", remoteResult.reason);
					}
					let openState = { attempted: true, usable: false };
					if (openResult.status === "fulfilled") {
						setOpenMarketplace(openResult.value);
						openState = getOpenMarketplaceLoadState(openResult.value);
						if (openResult.value.failedSourceIds.length > 0) {
							console.warn("Open marketplace sources failed", openResult.value.failedSourceIds);
						}
					} else {
						console.warn("Open marketplace catalog load failed", openResult.reason);
					}
					if (areAllAttemptedMarketSourcesUnavailable([serverState, openState])) {
						errors.push(i18n.t("abilities:error.loadFailed"));
					}
					setError(errors.length > 0 ? errors.join("; ") : null);
				})
				.finally(() => {
					setLoading(false);
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
