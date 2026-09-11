import type { SkillPresentation, SkillPresentationSurface, SkillVisibility } from "@vetta/capability-sdk";

export type { SkillPresentation, SkillPresentationSurface, SkillVisibility };

export type SkillProvenance =
	| { kind: "native"; scope: string }
	| { kind: "provided"; providerType: "plugin" | "sdk" | "runtime"; providerId: string }
	| { kind: "builtin"; providerId: string };

export interface SkillInfo {
	name: string;
	alias?: string;
	description: string;
	source: string;
	/** 结构化来源；缺失时按旧 source 兼容推断。 */
	provenance?: SkillProvenance;
	/** 提供方声明的产品展示策略；不影响运行时加载与调用。 */
	presentation?: SkillPresentation;
	/** 插件贡献的 skill 来源插件 ID；其它来源未定义。 */
	sourcePluginId?: string;
	type: "skill" | "scene";
	/**
	 * 已解析的本地展示图标（若有）：Skill 自身声明优先，其次继承 Provider；
	 * 市场与内置映射仅在本字段缺失时补齐。
	 */
	icon?: string;
}

export interface MarketSkillMeta {
	name: string;
	description: string;
	type: "skill" | "scene";
	version: string;
	author: string;
	tags: string[];
}

export interface InstalledMarketSkill {
	name: string;
	version: string;
	installedAt: string;
	source: "market";
	enabled: boolean;
	type?: "skill" | "scene";
	alias?: string;
	marketDescription?: string;
}

export interface InstalledCustomSkill {
	name: string;
	version: string;
	installedAt: string;
	source: "custom";
	enabled: boolean;
	/** 由 SKILL.md 的 `metadata.type` 决定；缺省按 skill。 */
	type: "skill" | "scene";
	alias?: string;
	description: string;
}

export type InstalledSkill = InstalledMarketSkill | InstalledCustomSkill;

export interface SkillMarketInstallResult {
	name: string;
	type: "skill" | "scene";
	version: string;
	updated: boolean;
}

export interface DesktopSkillsApi {
	/**
	 * 列出可调用资源；未登记清单、直接放入用户 Vetta 配置目录下 `scene` 的合法场景也会以 `source="scene"` 返回。
	 * @param cwd 当前会话/项目 cwd，用于发现项目级 `<cwd>/.agents/skills` 与 `<cwd>/.vetta/skills`；省略则仅列全局来源。
	 */
	list(cwd?: string): Promise<SkillInfo[]>;
	installFromMarket(
		name: string,
		archiveBuffer: ArrayBuffer,
		type: "skill" | "scene",
		/** sha256：市场归档包摘要，安装前校验；存量技能无摘要时省略，跳过校验 */
		meta?: { alias?: string; marketDescription?: string; version?: string; sha256?: string },
	): Promise<void>;
	/**
	 * 按市场 slug 下载并安装能力（skill/scene）。主进程鉴权/匿名下载，不经过 renderer token。
	 * 供 App Action 与官方插件使用。
	 */
	installFromMarketSlug(type: "skill" | "scene", slug: string): Promise<SkillMarketInstallResult>;
	/** 安装类型由包内 SKILL.md 的 `metadata.type` 决定（scene 装进 `~/.vetta/scene/`）。 */
	importCustom(archiveBuffer: ArrayBuffer): Promise<{ name: string; type: "skill" | "scene" }>;
	uninstall(name: string, type: "skill" | "scene"): Promise<void>;
	toggle(name: string): Promise<void>;
	getMarketManifest(): Promise<Record<string, InstalledSkill>>;
	getSkillMdPath(name: string, type: "skill" | "scene"): Promise<string>;
}
