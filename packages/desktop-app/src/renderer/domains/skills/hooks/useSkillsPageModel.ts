import type { InstalledSkill, SkillInfo } from "@preload/api";
import { i18n } from "@shared/i18n";
import type { MarketAbility } from "@shared/lib/api";
import { downloadAbility, fetchMarketAbilities } from "@shared/lib/api";
import { authTokenAtom, pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import type { ChangeEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ActionState = "idle" | "loading" | "done";

// 渲染期解析为 t("group.uncategorized")（模块级常量不存中文）。
export const UNCATEGORIZED = "__uncategorized__";

export interface MergedSkill {
	name: string;
	alias: string;
	description: string;
	type: "skill" | "scene";
	version: string;
	author: string;
	tags: string[];
	category: string;
	/** 空=默认；solar:xxx-bold；或已解析绝对图 URL */
	icon?: string;
	/** 市场归档包 sha256，安装前校验用；自定义/本地技能与存量市场技能为空 */
	sha256?: string;
	installed: boolean;
	enabled: boolean;
	needsUpdate: boolean;
	localVersion?: string;
	isCustom?: boolean;
	/** 通用 Agent Skill（~/.agents/skills）或内置：只读展示，不可安装/卸载/启停。 */
	isAgent?: boolean;
	/**
	 * 来源标识（仅 agent/builtin 等 listSkills 结果会写入）。
	 * `agents-user` / `agents-project` 对应 ~/.agents/skills 兼容发现。
	 */
	source?: string;
	downloadCount: number;
	license: string;
}

/** 市场 scene 行 + 本地安装清单 → 场景卡片模型。 */
function mergeScenes(market: MarketAbility[], manifest: Record<string, InstalledSkill>): MergedSkill[] {
	const merged = new Map<string, MergedSkill>();

	for (const entry of market) {
		if (entry.type !== "scene") continue;
		const local = manifest[entry.slug];
		const isMarketLocal = local?.source === "market";
		merged.set(entry.slug, {
			name: entry.slug,
			alias: entry.name,
			description: entry.description,
			type: "scene",
			version: entry.version,
			author: entry.author,
			tags: entry.tags,
			category: entry.category,
			icon: entry.icon || undefined,
			sha256: entry.sha256 || undefined,
			installed: isMarketLocal,
			enabled: isMarketLocal ? local.enabled : false,
			needsUpdate: isMarketLocal && local.version !== entry.version,
			localVersion: isMarketLocal ? local.version : undefined,
			downloadCount: entry.download_count,
			license: entry.license,
		});
	}

	for (const [name, local] of Object.entries(manifest)) {
		if (local.source === "custom" || local.type !== "scene") continue;
		if (merged.has(name)) continue;
		merged.set(name, {
			name,
			alias: local.alias ?? "",
			description: local.marketDescription ?? "",
			type: "scene",
			version: local.version,
			author: "",
			tags: [],
			category: "",
			installed: true,
			enabled: local.enabled,
			needsUpdate: false,
			localVersion: local.version,
			downloadCount: 0,
			license: "",
		});
	}

	return Array.from(merged.values());
}

export function groupByCategory(skills: MergedSkill[]): Map<string, MergedSkill[]> {
	const groups = new Map<string, MergedSkill[]>();
	for (const skill of skills) {
		const category = skill.category || UNCATEGORIZED;
		const group = groups.get(category);
		if (group) {
			group.push(skill);
		} else {
			groups.set(category, [skill]);
		}
	}
	for (const group of groups.values()) {
		group.sort((a, b) => {
			if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
			if (a.installed !== b.installed) return a.installed ? -1 : 1;
			// 同等安装态下按热度（下载量）降序，便于区分热门
			if (a.downloadCount !== b.downloadCount) return b.downloadCount - a.downloadCount;
			return a.name.localeCompare(b.name);
		});
	}
	return groups;
}

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
