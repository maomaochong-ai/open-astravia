/**
 * 设计源码的机检。
 *
 * 为什么需要它：引擎用 esbuild 剥类型、不做类型检查，所以「自己伪造一个 Link」
 * 「Icon 的 prop 名对不上」这类写法照样编译上屏，画布上看不出任何异常。指令写在
 * skill 里只是建议，模型的既有习惯会盖过去——真正能纠偏的是把违规摆回它面前。
 * 结果经 vetd_status 的 `issues` 返回，agent 本来就会反复调那个工具。
 *
 * 规则只收「能证明是错的」那些，宁可漏报不误报：一条误报会让 agent 去改本来正确
 * 的代码，比不报更糟。判断不了的（外壳是否只定义了一份、prop 是否真的匹配）留给
 * SKILL.md 的结构自查清单让 agent 自己看。
 */

import { isFrameFile } from "../../engine/src/routes";
import { parseFrameMeta } from "./frame-meta";

export interface SourceIssue {
	/** 相对设计包目录的路径，如 `frames/login.tsx`。 */
	file: string;
	/** 1 起算；定位不到具体行时为 null。 */
	line: number | null;
	rule: string;
	message: string;
}

export interface SourceFile {
	/** 相对设计包目录的路径。 */
	path: string;
	content: string;
}

/**
 * 尺寸没声明全的画框。单独给个名字是因为它不走下面那张规则表——判据要看**整份
 * 设计**（报错里要带上别的画框的尺寸），而规则表是逐行匹配的。
 */
const FRAME_SIZE_RULE = "frame-size-missing";

/** 单行超过这个长度基本可以断定是把整个组件压成了一行。 */
const MAX_LINE_LENGTH = 600;

/** `className` 里出现的写死颜色。只看 className，样式表里的 hex 是正当的。 */
const HEX_IN_CLASSNAME = /className\s*=\s*(?:"[^"]*#[0-9a-fA-F]{3,8}|\{`[^`]*#[0-9a-fA-F]{3,8})/;

/** `import x from "pkg"` / `import "pkg"` / `export * from "pkg"` 里的模块名。 */
const IMPORT_SOURCE = /^\s*(?:import|export)\b(?:[^'"]*\bfrom\s*)?["']([^"']+)["']/;

/**
 * 引擎 node_modules 里真实存在的东西（与 engine/package.json 的 dependencies 及
 * vite.config.mjs 的 alias 三处对齐）。设计源码 import 别的包一律构建失败——引擎是
 * 物化到插件数据目录的固定模板，agent 装不了包，也没有装包的入口。
 *
 * `lucide-react` 在这里是**兜底**，不是推荐用法：skill 只教 Iconify 的 CSS 类，但
 * 模型对「图标」的第一反应就是去 import 它，提示词纠正不掉。既然纠不掉就接住——
 * 装了以后两种写法都出图，而这条规则也就不能再报它了：报一个其实跑得起来的东西是
 * 误报，会让 agent 去改本来正确的代码，比不报更糟。
 */
const INSTALLED_PACKAGES = new Set(["react", "react-dom", "react-router", "lucide-react"]);

/**
 * 图标包单独拎出来给话术。模型换一个图标包再试一次是很自然的反应，报错里不写清楚
 * 「这里的图标是 CSS 类不是组件」，它就会一个个试过去。
 *
 * lucide-react 不在这张表里——它装了，见 INSTALLED_PACKAGES。
 */
const ICON_PACKAGES = new Set([
	"lucide",
	"react-icons",
	"react-feather",
	"@heroicons/react",
	"@tabler/icons-react",
	"@iconify/react",
	"@iconify-icon/react",
	"phosphor-react",
	"@phosphor-icons/react",
]);

/**
 * 引擎装了哪几套 Iconify 图标集。**必须与 engine/package.json 的 @iconify-json/*
 * 依赖保持一致**（那边加了这里就要加，SKILL.md 的 Offline sets 也是同一份名单）。
 *
 * 为什么值得机检：@iconify/tailwind4 找不到图标集时是直接 throw（"Cannot load icon
 * set"），整个 frame 构建失败。类名里的集合名是纯字符串，判得死死的，不必等构建炸。
 */
const INSTALLED_ICON_SETS = ["lucide", "mdi", "simple-icons", "tabler"];

/** `icon-[lucide--search]` 里的集合名。 */
const ICONIFY_CLASS = /icon-\[([a-z0-9-]+)--/;

/** theme.css 的 `@theme` 里声明的颜色 token：`--color-surface-raised: #08090a;`。 */
const THEME_COLOR_TOKEN = /--color-([a-z][a-z0-9-]*)\s*:/g;

/**
 * `bg-` 后面跟的非颜色工具值。
 *
 * 这张表决定了 `undefined-theme-token` 的误报面，所以只保留 `bg-` 这一个前缀来检查：
 * `text-`（text-sm / text-center / text-balance…）和 `border-`（border-2 / border-t /
 * border-dashed…）里颜色与非颜色混在一起，靠名单区分必然漏，漏了就是误报。`bg-` 后面
 * 除了下面这些就只有颜色，判据干净。
 */
const BG_NON_COLOR = new Set([
	"auto",
	"blend",
	"bottom",
	"center",
	"clip",
	"contain",
	"cover",
	"fixed",
	"gradient",
	"left",
	"linear",
	"local",
	"no",
	"none",
	"origin",
	"repeat",
	"radial",
	"repeat",
	"right",
	"scroll",
	"top",
	"conic",
]);

/** Tailwind 自带的调色板名。带数字档位的（`bg-red-500`）由 `\d` 判据先行排除。 */
const BUILTIN_COLORS = new Set([
	"black",
	"current",
	"inherit",
	"transparent",
	"white",
	"amber",
	"blue",
	"cyan",
	"emerald",
	"fuchsia",
	"gray",
	"green",
	"indigo",
	"lime",
	"neutral",
	"orange",
	"pink",
	"purple",
	"red",
	"rose",
	"sky",
	"slate",
	"stone",
	"teal",
	"violet",
	"yellow",
	"zinc",
]);

/**
 * className 属性里出现的 `bg-<name>`。
 *
 * name 由纯字母段用连字符连起来，且后面不能再跟字母数字或连字符——`bg-red-500` 这类
 * 带档位的内置色必须整条不匹配。写成 `[a-z-]*` 会在这里回溯出 `red-` 交给下游，而
 * `red-` 不在任何名单里，于是一条完全正确的 Tailwind 类被报成未定义 token。
 */
const BG_TOKEN_CLASS = /\bbg-([a-z]+(?:-[a-z]+)*)(?![\w-])/g;

/** theme.css 里声明了哪些颜色 token。读不到文件时返回 null——没有事实源就不做这项检查。 */
export function themeColorTokens(themeCss: string | null): ReadonlySet<string> | null {
	if (themeCss === null) return null;
	const tokens = new Set<string>();
	for (const match of themeCss.matchAll(THEME_COLOR_TOKEN)) tokens.add(match[1]);
	return tokens.size > 0 ? tokens : null;
}

/**
 * 用了一个 theme.css 里没有的颜色 token。
 *
 * Tailwind 对解析不出来的类名不生成任何 CSS——元素照常占位，只是没有背景色，源码怎么
 * 读都是对的。截图那条链路能量出来（layout-probe 的 bg-token-undefined），但那要等到
 * 渲染；这里在磁盘上就能判，写完就报得出来。
 *
 * 只在 theme.css 真的解析出了 token 时才启用：拿不到事实源就宁可不报。
 */
function checkThemeTokens(file: SourceFile, tokens: ReadonlySet<string>): SourceIssue[] {
	const issues: SourceIssue[] = [];
	const seen = new Set<string>();
	for (const [index, line] of file.content.split("\n").entries()) {
		if (!/className\s*=/.test(line)) continue;
		for (const match of line.matchAll(BG_TOKEN_CLASS)) {
			const name = match[1];
			if (BG_NON_COLOR.has(name) || BUILTIN_COLORS.has(name) || tokens.has(name)) continue;
			// 复合内置值（bg-gradient-to-r / bg-clip-text）第一段就在名单里，整串不是。
			if (BG_NON_COLOR.has(name.split("-")[0])) continue;
			if (seen.has(name)) continue;
			seen.add(name);
			issues.push({
				file: file.path,
				line: index + 1,
				rule: "undefined-theme-token",
				message: `Uses \`bg-${name}\`, but \`--color-${name}\` is not declared in theme.css \`@theme\`. Tailwind emits no CSS for a class it cannot resolve, so this element renders with no background at all while the source reads fine. Declare the token in theme.css, or use one that exists: ${[...tokens].slice(0, 12).join(", ")}.`,
			});
		}
	}
	return issues;
}

/** `@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`。相对路径返回 null。 */
function packageNameOf(source: string): string | null {
	if (source.startsWith(".") || source.startsWith("/") || source.startsWith("@design")) return null;
	const parts = source.split("/");
	return source.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

interface Rule {
	id: string;
	/** 命中行的判据。 */
	test(line: string, file: SourceFile): boolean;
	/** 函数形式用于把命中的具体内容（比如包名）写进报错。 */
	message: string | ((line: string) => string);
	/**
	 * 同一文件内的去重键，默认整条规则只报一次。只有当同一条规则在一个文件里能命中
	 * **不同的事实**时才需要它——比如 import 了两个不同的缺失包，只报一个会逼 agent
	 * 修完再跑一轮才看到第二个。
	 */
	dedupeBy?(line: string): string;
}

const RULES: Rule[] = [
	{
		id: "fake-router",
		test: (line) => /^\s*(?:const|function)\s+(Link|NavLink|useNavigate|useLocation|Outlet)\b/.test(line),
		message:
			"Redefines a react-router primitive locally. Import it instead: `import { Link, useLocation } from \"react-router\"` — a hand-rolled Link renders a plain <a> and forces a full page reload. See references/interaction.md.",
	},
	{
		id: "anchor-navigation",
		test: (line) => /<a\s[^>]*href\s*=\s*(?:"\/(?!\/)|\{`\/)/.test(line),
		message:
			"Uses <a href> to move between screens. Use <Link to> from react-router — a bare anchor reloads the whole app and remounts any shared shell. See references/interaction.md.",
	},
	{
		id: "uninstalled-import",
		test: (line) => {
			const source = IMPORT_SOURCE.exec(line)?.[1];
			if (!source) return false;
			const pkg = packageNameOf(source);
			return pkg !== null && !INSTALLED_PACKAGES.has(pkg);
		},
		message: (line) => {
			const pkg = packageNameOf(IMPORT_SOURCE.exec(line)?.[1] ?? "") ?? "that package";
			const base = `Imports "${pkg}", which the design engine does not have — this frame will fail to build. Only react, react-router, Tailwind v4 and Iconify are installed, and there is no way to add a dependency.`;
			return ICON_PACKAGES.has(pkg)
				? `${base} Icons here are Iconify CSS classes, not components: <span className="icon-[lucide--search] size-4" />.`
				: `${base} Build it from what is there: Tailwind utilities for layout/visuals, an Iconify class for a glyph, plain React state for behaviour.`;
		},
		dedupeBy: (line) => packageNameOf(IMPORT_SOURCE.exec(line)?.[1] ?? "") ?? "",
	},
	{
		id: "unknown-icon-set",
		test: (line) => {
			const set = ICONIFY_CLASS.exec(line)?.[1];
			return set !== undefined && !INSTALLED_ICON_SETS.includes(set);
		},
		message: (line) => {
			const set = ICONIFY_CLASS.exec(line)?.[1] ?? "";
			return `Uses the "${set}" icon set, which is not installed — the frame will fail to build ("Cannot load icon set"). Offline sets are: ${INSTALLED_ICON_SETS.join(", ")}. Pick the closest glyph from one of those; there is no way to add a set.`;
		},
		dedupeBy: (line) => ICONIFY_CLASS.exec(line)?.[1] ?? "",
	},
	{
		id: "custom-icon-component",
		test: (line) => /^\s*(?:const|function)\s+Icon\b/.test(line),
		message:
			"Defines its own Icon component. Icons are Iconify classes: <span className=\"icon-[lucide--search] size-4\" />. Hand-rolled icon components drift between frames and usually render one fallback glyph everywhere.",
	},
	{
		id: "hardcoded-color",
		test: (line) => HEX_IN_CLASSNAME.test(line),
		message:
			"Hardcodes a hex color in className. Use theme tokens (bg-primary, text-muted, border-border) and add new ones to theme.css @theme, so the whole document reskins from one place.",
	},
	{
		id: "viewport-height",
		test: (line) => /className\s*=\s*(?:"[^"]*|\{`[^`]*)\b(?:min-h-screen|h-screen)\b/.test(line),
		message:
			"Uses h-screen/min-h-screen. A frame is a fixed-size canvas, not a viewport — use h-full so the layout follows the frame's declared size.",
	},
	{
		id: "minified-source",
		test: (line) => line.length > MAX_LINE_LENGTH,
		message: `Line is over ${MAX_LINE_LENGTH} characters — the source is written as one long line. Element→source mapping is per line, so every element then reports the same location and the user's "让 Vetta 调整" can no longer target anything. Format it normally, one element per line for nested markup.`,
	},
];

/** `frames/login.tsx` → `login`；不是画框文件（`_layout.tsx`、components/）返回 null。 */
function frameIdOf(path: string): string | null {
	const name = path.startsWith("frames/") ? path.slice("frames/".length) : null;
	if (!name || name.includes("/") || !name.endsWith(".tsx") || !isFrameFile(name)) return null;
	return name.replace(/\.tsx$/, "");
}

/**
 * 画框应该自己声明尺寸。
 *
 * 漏了不再是致命的——reconcile 会拿同一份设计的多数派尺寸把它渲染出来（见
 * frame-size.ts），所以这条从「画不出来」降级成了「尺寸是猜的」。但仍然要报：
 * 猜的尺寸对不对只有 agent 知道，而一份设计里混着推断尺寸迟早会咬人。
 *
 * 报错里带上同一份设计里其他画框的尺寸：agent 补声明时多半是想跟已有屏保持一致，
 * 让它自己再去把文件读一遍是白跑一趟。
 */
function checkFrameSize(file: SourceFile, others: readonly SourceFile[]): SourceIssue | null {
	const id = frameIdOf(file.path);
	if (!id) return null;
	const meta = parseFrameMeta(file.content, id);
	if (meta.width !== null && meta.height !== null) return null;

	const known: string[] = [];
	for (const other of others) {
		const otherId = other === file ? null : frameIdOf(other.path);
		if (!otherId) continue;
		const otherMeta = parseFrameMeta(other.content, otherId);
		if (otherMeta.width === null || otherMeta.height === null) continue;
		known.push(`${otherId} ${otherMeta.width}x${otherMeta.height}`);
	}
	const missing = [meta.width === null && "width", meta.height === null && "height"].filter(Boolean).join(" and ");
	const reference =
		known.length > 0
			? ` Existing frames in this design: ${known.join(", ")} — match one of them unless this screen is a different product type.`
			: " Pick the size from the product type (see the vetta-ui-design skill).";
	return {
		file: file.path,
		line: null,
		rule: FRAME_SIZE_RULE,
		message: `Frame meta is missing ${missing}. Declare it as the first statement: \`export const frame = { width: 390, height: 844, title: "登录" };\`. The frame IS on the canvas — it was rendered at a size inferred from the rest of the design — but the inferred size is a guess, so declare the one you actually want.${reference}`,
	};
}

/**
 * 每条规则每个文件只报一次：同一个毛病在一个文件里往往命中几十行，全报出来会把
 * vetd_status 的返回撑爆，而 agent 需要的信息第一条就给全了。
 */
export function checkSources(files: readonly SourceFile[], themeCss: string | null = null): SourceIssue[] {
	const issues: SourceIssue[] = [];
	const tokens = themeColorTokens(themeCss);
	for (const file of files) {
		const sizeIssue = checkFrameSize(file, files);
		if (sizeIssue) issues.push(sizeIssue);
		if (tokens) issues.push(...checkThemeTokens(file, tokens));
		const lines = file.content.split("\n");
		const reported = new Set<string>();
		for (const [index, line] of lines.entries()) {
			for (const rule of RULES) {
				if (!rule.test(line, file)) continue;
				const key = rule.dedupeBy ? `${rule.id}:${rule.dedupeBy(line)}` : rule.id;
				if (reported.has(key)) continue;
				reported.add(key);
				issues.push({
					file: file.path,
					line: index + 1,
					rule: rule.id,
					message: typeof rule.message === "string" ? rule.message : rule.message(line),
				});
			}
		}
	}
	return issues;
}
