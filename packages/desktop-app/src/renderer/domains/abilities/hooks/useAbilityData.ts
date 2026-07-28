/**
 * 能力页的原始数据源：市场行 + 安装台账 + 三条安装轨道的本地状态。
 * 只负责取数与刷新，条目组装在 lib/build-ability-items.ts。
 */
import type { AbilityLedger, InstalledPlugin, InstalledSkill, OpenMarketplaceCatalog, SkillInfo } from "@preload/api";
import { i18n } from "@shared/i18n";
import type { MarketAbility } from "@shared/lib/api";
import { fetchMarketAbilities } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { mergeAbilityCatalogs } from "../lib/merge-ability-catalogs";

export interface AbilityData {
	market: MarketAbility[];
	ledger: AbilityLedger;
	skillManifest: Record<string, InstalledSkill>;
	/** 通用 Agent / 内置 skill 与 scene（只读展示）。 */
	localSkills: SkillInfo[];
	plugins: InstalledPlugin[];
	loading: boolean;
	refreshing: boolean;
	error: string | null;
	refresh: () => void;
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
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(
		(forceOpenMarketplaceRefresh: boolean) => {
			setRefreshing(true);
			const local = Promise.all([
				window.vetta.abilities.getLedger(),
				window.vetta.skills.getMarketManifest(),
				window.vetta.skills.list(),
				window.vetta.plugins.list(),
			]);

			const remote = token ? fetchMarketAbilities(token) : Promise.resolve([]);
			const open = forceOpenMarketplaceRefresh
				? window.vetta.abilities.refreshOpenMarketplaces()
				: window.vetta.abilities.listOpenMarketplaces();

			void Promise.allSettled([local, remote, open])
				.then(([localResult, remoteResult, openResult]) => {
					const errors: string[] = [];
					if (localResult.status === "fulfilled") {
						const [nextLedger, manifest, skills, installedPlugins] = localResult.value;
						setLedger(nextLedger);
						setSkillManifest(manifest);
						setLocalSkills(skills.filter((skill) => isReadonlySkillSource(skill.source)));
						setPlugins(installedPlugins);
					} else {
						errors.push(
							localResult.reason instanceof Error
								? localResult.reason.message
								: i18n.t("abilities:error.loadFailed"),
						);
					}
					if (remoteResult.status === "fulfilled") {
						setServerMarket(remoteResult.value);
					} else {
						errors.push(
							remoteResult.reason instanceof Error
								? remoteResult.reason.message
								: i18n.t("abilities:error.loadFailed"),
						);
					}
					if (openResult.status === "fulfilled") {
						setOpenMarketplace(openResult.value);
						if (openResult.value.failedSourceIds.length > 0) {
							errors.push(i18n.t("abilities:error.openMarketplaceSyncFailed"));
						}
					} else {
						errors.push(i18n.t("abilities:error.openMarketplaceSyncFailed"));
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

	useEffect(() => {
		load(false);
	}, [load]);

	const market = useMemo(
		() => mergeAbilityCatalogs(serverMarket, openMarketplace.snapshots, ledger),
		[ledger, openMarketplace.snapshots, serverMarket],
	);

	return { market, ledger, skillManifest, localSkills, plugins, loading, refreshing, error, refresh };
}
