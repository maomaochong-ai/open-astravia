/** 一个内置设计体系：theme.css 是单一真源，DESIGN.md 是给 agent 的完整规范。 */
export interface DesignSystem {
	/** 稳定 id（kebab-case），写进 DESIGN.md frontmatter 的 `system:`。 */
	id: string;
	/** 品牌名，不翻译。 */
	name: string;
	/** 分类 key，经 locales 渲染（`designSystems.category.<key>`）。 */
	category: string;
	/** 标志形态是亮底还是暗底（drawer 上的小标识，不做双套主题）。 */
	vibe: "light" | "dark";
	/** 给模型看的一句英文风格摘要（vetd_design_systems 的 list 用法返回它做推荐依据）。 */
	blurb: string;
	/** UI 里的一句话风格摘要走 i18n：`ds.tagline.<id>`。 */
	/** 完整 theme.css 内容（含 @theme 块），应用时原样写入。 */
	themeCss: string;
	/** Vetta 定制版 DESIGN.md 内容（不含 frontmatter，写入时由 apply 拼接）。 */
	designMd: string;
}
