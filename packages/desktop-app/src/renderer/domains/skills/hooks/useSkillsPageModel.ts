import type { InstalledSkill, SkillInfo } from "@preload/api";
import { i18n } from "@shared/i18n";
import type { MarketAbility } from "@shared/lib/api";
import { downloadAbility, fetchMarketAbilities } from "@shared/lib/api";
import { authTokenAtom, pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import type { ChangeEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupByCategory, type MergedSkill, mergeScenes } from "../lib/merge-scenes";

export type ActionState = "idle" | "loading" | "done";

export type { MergedSkill } from "../lib/merge-scenes";
export { groupByCategory, UNCATEGORIZED } from "../lib/merge-scenes";

export interface SkillsPageModel {
	searchQuery: string;
	setSearchQuery: (query: string) => void;
	loading: boolean;
	error: string | null;
	actionStates: Record<string, ActionState>;
	fileInputRef: RefObject<HTMLInputElement | null>;
	groups: Map<string, MergedSkill[]>;
	agentForTab: MergedSkill[];
	hasContent: boolean;
	handleInstall: (skill: MergedSkill) => void;
	handleToggle: (name: string) => void;
	handleUninstall: (name: string, type: "skill" | "scene") => void;
	/** 场景详情统一走能力页的详情抽屉（/abilities?detail=<type>:<slug>）。 */
	handlePreview: (skill: MergedSkill) => void;
	handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** 场景页模型；能力（skill / mcp / plugin / bundle）已并入 domains/abilities。 */
export function useSkillsPageModel(): SkillsPageModel {
	const navigate = useNavigate();
	const [searchQuery, setSearchQuery] = useState("");
	const [market, setMarket] = useState<MarketAbility[]>([]);
	const [manifest, setManifest] = useState<Record<string, InstalledSkill>>({});
	const [agentSkills, setAgentSkills] = useState<SkillInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
	const fileInputRef = useRef<HTMLInputElement>(null);

	const token = useAtomValue(authTokenAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);

	const refresh = useCallback(() => {
		void window.vetta.skills.getMarketManifest().then(setManifest);
		void window.vetta.skills
			.list()
			.then((list) => setAgentSkills(list.filter((s) => s.source.startsWith("agents-") || s.source === "builtin")));
	}, []);

	const loadMarket = useCallback(() => {
		if (!token) {
			// 未登录：不拉取市场数据，但仍展示本地已安装/Agent 场景。
			setMarket([]);
			setError(null);
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		void fetchMarketAbilities(token)
			.then((list) => {
				setMarket(list);
				setError(null);
			})
			.catch((err: Error) => {
				setError(err.message || i18n.t("skills:error.loadFailed"));
			})
			.finally(() => setLoading(false));
	}, [token]);

	useEffect(() => {
		refresh();
		loadMarket();
	}, [refresh, loadMarket]);

	// 场景页内已有大号标题，隐藏顶栏左上角路由标题。
	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	const setActionState = useCallback((name: string, state: ActionState) => {
		setActionStates((prev) => ({ ...prev, [name]: state }));
	}, []);

	const handleInstall = useCallback(
		(skill: MergedSkill) => {
			if (!token) return;
			setActionState(skill.name, "loading");
			void downloadAbility(skill.type, skill.name, token)
				.then((buffer) =>
					window.vetta.skills.installFromMarket(skill.name, buffer, skill.type, {
						alias: skill.alias,
						marketDescription: skill.description,
						version: skill.version,
						sha256: skill.sha256,
					}),
				)
				.then(() => {
					setActionState(skill.name, "done");
					refresh();
				})
				.catch((err: Error) => {
					setActionState(skill.name, "idle");
					console.error("安装失败:", err.message);
				});
		},
		[token, refresh, setActionState],
	);

	const handleToggle = useCallback(
		(name: string) => {
			void window.vetta.skills
				.toggle(name)
				.then(() => refresh())
				.catch((err: Error) => {
					console.error("切换失败:", err.message);
				});
		},
		[refresh],
	);

	const handleUninstall = useCallback(
		(name: string, type: "skill" | "scene") => {
			setActionState(name, "loading");
			void window.vetta.skills
				.uninstall(name, type)
				.then(() => {
					setActionState(name, "idle");
					refresh();
				})
				.catch((err: Error) => {
					setActionState(name, "idle");
					console.error("卸载失败:", err.message);
				});
		},
		[refresh, setActionState],
	);

	const handlePreview = useCallback(
		(skill: MergedSkill) => {
			void navigate({ to: "/abilities", search: { detail: `${skill.type}:${skill.name}` } });
		},
		[navigate],
	);

	const handleFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) return;
			void file
				.arrayBuffer()
				.then((buffer) => window.vetta.skills.importCustom(buffer))
				.then(() => refresh())
				.catch((err: Error) => {
					alert(i18n.t("skills:import.failed", { error: err.message || i18n.t("skills:import.unknownError") }));
				});
		},
		[refresh],
	);

	const merged = useMemo(() => mergeScenes(market, manifest), [market, manifest]);

	const filterBySearch = useCallback(
		(list: MergedSkill[]) => {
			const q = searchQuery.trim().toLowerCase();
			if (!q) return list;
			return list.filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.alias.toLowerCase().includes(q) ||
					s.description.toLowerCase().includes(q) ||
					s.tags.some((tag) => tag.toLowerCase().includes(q)),
			);
		},
		[searchQuery],
	);

	const groups = useMemo(() => groupByCategory(filterBySearch(merged)), [merged, filterBySearch]);

	// 通用 Agent Scene 只读分区。
	const agentForTab = useMemo<MergedSkill[]>(
		() =>
			filterBySearch(
				agentSkills
					.filter((s) => s.type === "scene")
					.map((s) => ({
						name: s.name,
						alias: s.alias ?? "",
						description: s.description,
						type: s.type,
						version: "",
						author: "",
						tags: [],
						category: "",
						installed: true,
						enabled: true,
						needsUpdate: false,
						isAgent: true,
						source: s.source,
						downloadCount: 0,
						license: "",
					})),
			),
		[agentSkills, filterBySearch],
	);

	const hasContent = groups.size > 0 || agentForTab.length > 0;

	return {
		searchQuery,
		setSearchQuery,
		loading,
		error,
		actionStates,
		fileInputRef,
		groups,
		agentForTab,
		hasContent,
		handleInstall,
		handleToggle,
		handleUninstall,
		handlePreview,
		handleFileChange,
	};
}
