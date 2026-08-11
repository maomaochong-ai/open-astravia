/** 资源在一套体系里承担的角色；没有角色的就是普通参考素材（截图、参考 HTML…）。 */
export type DesignResourceRole = "spec" | "theme" | "preview" | "package";

/**
 * 一套体系带的一份资源文件。
 *
 * 文本内容随清单一起送达（`text`）；图片、字体这类二进制只带地址，等用户真的选了这套
 * 体系再下载（`binary`）——否则一张截图就能把清单撑到几 MB。
 */
export type DesignResource =
	| { path: string; role?: DesignResourceRole; encoding: "text"; content: string; bytes: number }
	| { path: string; role?: DesignResourceRole; encoding: "binary"; url: string; bytes: number };

/** 一个设计体系：theme.css 是单一真源，DESIGN.md 是给 agent 的完整规范。 */
export interface DesignSystem {
	/** 稳定 id（kebab-case），写进 DESIGN.md frontmatter 的 `system:`。 */
	id: string;
	/** 品牌名，不翻译。 */
	name: string;
	/** 分类 key，经 locales 渲染（`ds.category.<key>`）。 */
	category: string;
	/** 标志形态是亮底还是暗底（drawer 上的小标识，不做双套主题）。 */
	vibe: "light" | "dark";
	/** 一句英文风格摘要；没有 tagline 译文时用它兜底显示。 */
	blurb: string;
	/**
	 * UI 里的一句话风格摘要，由条目自带译文——远端 id 不可能预先出现在插件 locales 里。
	 * 缺省时由 `designSystemTagline` 回落到 blurb。
	 */
	tagline?: { en: string; zh: string };
	/**
	 * 这套体系带的全部资源，按仓库里的目录结构原样落到项目的参考资料目录。
	 * `themeCss` / `designMd` 是其中 `theme` / `spec` 两个角色的快捷入口。
	 */
	resources: readonly DesignResource[];
	/** 完整 theme.css 内容（含 @theme 块），应用时原样写入。 */
	themeCss: string;
	/** Vetta 定制版 DESIGN.md 内容（不含 frontmatter，写入时由 apply 拼接）。 */
	designMd: string;
	/** 内容出处，写进 DESIGN.md frontmatter 的 `source:`；缺省用内置的上游地址。 */
	source?: string;
	/** 许可标识，写进 frontmatter 的 `license:`；缺省 MIT。 */
	license?: string;
}
