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
 * references/self-check.md 让 agent 自己看。
 */

import { isFrameFile } from "../../engine/src/routes";
import { parseFrameMeta } from "./frame-meta";

export interface SourceIssue {
	/** 相对 sidecar 目录的路径，如 `frames/login.tsx`。 */
	file: string;
	/** 1 起算；定位不到具体行时为 null。 */
	line: number | null;
	rule: string;
	message: string;
}

export interface SourceFile {
	/** 相对 sidecar 目录的路径。 */
	path: string;
	content: string;
}

/** 单行超过这个长度基本可以断定是把整个组件压成了一行。 */
const MAX_LINE_LENGTH = 600;

/** `className` 里出现的写死颜色。只看 className，样式表里的 hex 是正当的。 */
const HEX_IN_CLASSNAME = /className\s*=\s*(?:"[^"]*#[0-9a-fA-F]{3,8}|\{`[^`]*#[0-9a-fA-F]{3,8})/;

interface Rule {
	id: string;
	/** 命中行的判据。 */
	test(line: string, file: SourceFile): boolean;
	message: string;
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
 * 画框尺寸必须自己声明——没有默认值可回落，声明不全的画框根本上不了画布。
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
		rule: "frame-size-missing",
		message: `Frame meta is missing ${missing}. Declare it as the first statement: \`export const frame = { width: 390, height: 844, title: "登录" };\`. There is no default size — the frame stays off the canvas until both are declared.${reference}`,
	};
}

/**
 * 每条规则每个文件只报一次：同一个毛病在一个文件里往往命中几十行，全报出来会把
 * vetd_status 的返回撑爆，而 agent 需要的信息第一条就给全了。
 */
export function checkSources(files: readonly SourceFile[]): SourceIssue[] {
	const issues: SourceIssue[] = [];
	for (const file of files) {
		const sizeIssue = checkFrameSize(file, files);
		if (sizeIssue) issues.push(sizeIssue);
		const lines = file.content.split("\n");
		const reported = new Set<string>();
		for (const [index, line] of lines.entries()) {
			for (const rule of RULES) {
				if (reported.has(rule.id)) continue;
				if (!rule.test(line, file)) continue;
				reported.add(rule.id);
				issues.push({ file: file.path, line: index + 1, rule: rule.id, message: rule.message });
			}
		}
	}
	return issues;
}
