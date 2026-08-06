export interface SkillInfo {
	name: string;
	alias?: string;
	description: string;
	source: string;
	type: "skill" | "scene";
	/**
	 * 展示图标（若有）：插件贡献的 skill 填宿主插件的 `iconUrl`（多为 `vetta-plugin://`），
	 * 市场 / 内置图标仍由命令区的目录解析与静态映射补齐，本字段不覆盖它们。
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
	type: "skill";
	alias?: string;
	description: string;
}

export type InstalledSkill = InstalledMarketSkill | InstalledCustomSkill;

export interface DesktopSkillsApi {
	/** @param cwd 当前会话/项目 cwd，用于发现项目级 `<cwd>/.agents/skills` 与 `<cwd>/.vetta/skills`；省略则仅列全局来源。 */
	list(cwd?: string): Promise<SkillInfo[]>;
	installFromMarket(
		name: string,
		archiveBuffer: ArrayBuffer,
		type: "skill" | "scene",
		/** sha256：市场归档包摘要，安装前校验；存量技能无摘要时省略，跳过校验 */
		meta?: { alias?: string; marketDescription?: string; version?: string; sha256?: string },
	): Promise<void>;
	importCustom(archiveBuffer: ArrayBuffer): Promise<{ name: string }>;
	uninstall(name: string, type: "skill" | "scene"): Promise<void>;
	toggle(name: string): Promise<void>;
	getMarketManifest(): Promise<Record<string, InstalledSkill>>;
	getSkillMdPath(name: string, type: "skill" | "scene"): Promise<string>;
}
