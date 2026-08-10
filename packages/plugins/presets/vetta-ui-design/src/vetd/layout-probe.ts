/**
 * 渲染态的机检：在截图的同一帧上量 DOM，把「只有看图才发现得了」的那几类缺陷
 * 变成确定的判据。
 *
 * 为什么放在这里而不是继续写进提示词：截图本来就要完成一次真实渲染，而渲染出来的
 * DOM 里，「这个图标是不是空的」「这行字是不是被裁了」都是可以量出来的数。让模型
 * 去图里找，既要它记得找，又要它看得出 3px 的错位——references/quality.md 把这些
 * 列成清单已经是当前能做到的上限，再往上只能靠量。
 *
 * 判据一律取保守的那一侧，理由同 check-sources：一条误报会让 agent 去改本来正确的
 * 代码，比不报更糟。所以这里只收「量出来就一定不对」的：图标位没有任何图形、文字
 * 在 overflow:hidden 下真的超出了、短文本控件真的排到了第二行、同一行的兄弟元素
 * 差那么几个像素。审美、层级、文案是否可信仍然只能看图，不在这里判。
 */

import type { SourceIssue } from "./check-sources";

/** 每条规则最多回报几处：同一个毛病往往整屏都是，前几处足够定位病根。 */
const MAX_PER_RULE = 3;

/** 判定「差一点点没对齐」的像素窗口。0 是对齐，超过上限多半是有意的层次差。 */
const MISALIGN_MIN_PX = 0.5;
const MISALIGN_MAX_PX = 4;

/**
 * 在离屏页面里执行的探针。
 *
 * 写成字符串是因为它要跨进程去页面上下文求值（ctx.capture 的 probeScript），拿不到
 * 这边的模块作用域。相应地，它不能依赖任何外部符号，也不该抛——宿主会把异常吞成
 * `probe: undefined`，但那样就分不清「没毛病」和「探针自己坏了」，所以每条规则各自
 * try 住，坏掉的规则只是不出结果。
 */
export const LAYOUT_PROBE_SCRIPT = `(() => {
	const MAX = ${MAX_PER_RULE};
	const out = [];
	const push = (rule, el, detail) => {
		if (out.filter((item) => item.rule === rule).length >= MAX) return;
		let node = el;
		let source = null;
		while (node && !source) {
			source = node.getAttribute && node.getAttribute("data-vetd-source");
			node = node.parentElement;
		}
		const text = (el.textContent || "").trim().slice(0, 40);
		out.push({ rule, source: source || null, detail, text });
	};
	const safe = (fn) => { try { fn(); } catch {} };
	// 「这个属性画了东西」必须是肯定的判断：读不到的属性是 undefined，拿它去和 "none"
	// 比不等会得到真，把一个空图标当成画好了的。
	const paints = (value) => typeof value === "string" && value !== "" && value !== "none";
	const root = document.body;
	if (!root) return [];

	// 图标位没有任何图形。Iconify 的 tailwind4 预设把图标编译成 mask-image；类名没被
	// 解析出来时元素照样在，只是什么都不画——图里表现为一块空白，源码怎么读都是对的。
	safe(() => {
		for (const el of root.querySelectorAll('[class*="icon-["]')) {
			const style = getComputedStyle(el);
			if (paints(style.maskImage) || paints(style.webkitMaskImage) || paints(style.backgroundImage)) continue;
			const cls = (el.getAttribute("class") || "").split(/\\s+/).find((c) => c.indexOf("icon-[") === 0) || "";
			push("icon-missing", el, cls);
		}
	});

	// bg-<token> 写了却没上色。theme.css 的 @theme 里没定义这个 token 时，Tailwind
	// 一行 CSS 都不生成，元素保持透明——源码读起来完全正常。这里不猜类名合不合法，
	// 直接看渲染结果：写了背景色却量到全透明，就是没生效。
	safe(() => {
		for (const el of root.querySelectorAll('[class*="bg-"]')) {
			const cls = el.getAttribute("class") || "";
			const token = (cls.split(/\\s+/).find((c) => /^bg-[a-z][a-z-]*$/.test(c)) || "").slice(3);
			if (!token || token === "transparent" || token === "inherit" || token === "current" || token === "none") {
				continue;
			}
			const style = getComputedStyle(el);
			if (paints(style.backgroundImage)) continue;
			// 同理反过来：颜色读不出来时不能当作「透明」去报，那是凭空造一条 issue。
			const bg = style.backgroundColor;
			if (typeof bg !== "string" || bg === "") continue;
			if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") continue;
			push("bg-token-undefined", el, "bg-" + token);
		}
	});

	// 文字真的被容器裁掉了。只认 overflow 明确藏起来的情况：可滚动的区域超出是正常的。
	safe(() => {
		for (const el of root.querySelectorAll("*")) {
			if (!el.firstChild || el.children.length > 0) continue;
			const style = getComputedStyle(el);
			const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
			const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
			const overX = clipsX && el.scrollWidth > el.clientWidth + 1;
			const overY = clipsY && el.scrollHeight > el.clientHeight + 1;
			if (!overX && !overY) continue;
			if (style.textOverflow === "ellipsis") continue;
			const by = overX ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
			push("text-clipped", el, (overX ? "horizontally" : "vertically") + " by " + by + "px");
		}
	});

	// 短文本控件排到了第二行。段落换行是正常的，所以只看这几类「一行放不下就是设计
	// 出问题」的元素。
	safe(() => {
		const selector = 'button, th, label, [role="tab"], [role="button"], nav a';
		for (const el of root.querySelectorAll(selector)) {
			if (el.children.length > 1) continue;
			const style = getComputedStyle(el);
			if (style.whiteSpace === "pre" || style.whiteSpace === "pre-wrap") continue;
			const range = document.createRange();
			range.selectNodeContents(el);
			const lines = range.getClientRects().length;
			range.detach && range.detach();
			if (lines <= 1) continue;
			push("unintended-wrap", el, "renders on " + lines + " lines");
		}
	});

	// 同一行的兄弟元素差那么几个像素。完全对齐是 0，明显的层次差不会只差 4px 以内——
	// 落在中间的基本都是漏了 items-center 或某一处 padding 飘了。
	safe(() => {
		for (const parent of root.querySelectorAll("*")) {
			const style = getComputedStyle(parent);
			if (style.display !== "flex" && style.display !== "inline-flex") continue;
			if (style.flexDirection !== "row") continue;
			const kids = Array.from(parent.children).filter((k) => {
				const r = k.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			});
			if (kids.length < 2) continue;
			const tops = kids.map((k) => k.getBoundingClientRect().top);
			const min = Math.min(...tops);
			const max = Math.max(...tops);
			const delta = max - min;
			if (delta <= ${MISALIGN_MIN_PX} || delta > ${MISALIGN_MAX_PX}) continue;
			push("edge-misaligned", parent, "children top edges differ by " + delta.toFixed(1) + "px");
		}
	});

	return out;
})()`;

interface RawFinding {
	rule: string;
	source: string | null;
	detail: string;
	text: string;
}

/** 每条规则的报错文案。写清楚「量到了什么」和「往哪改」，不写「请检查」。 */
const MESSAGES: Record<string, (finding: RawFinding) => string> = {
	"icon-missing": (finding) =>
		`Icon slot renders nothing — \`${finding.detail}\` produced no mask-image, so the element occupies space with no glyph in it. The class name resolved to no CSS: check the icon set is one of the installed ones and that the glyph name exists in it. The source reads fine either way, which is why this only shows up in the rendering.`,
	"bg-token-undefined": (finding) =>
		`\`${finding.detail}\` produced no background — the element measured fully transparent, so Tailwind emitted no CSS for that class. The theme token behind it is not defined in theme.css \`@theme\`: add \`--color-${finding.detail.slice(3)}\` there, or use a token that exists. The source reads fine either way, which is why this only shows up in the rendering.`,
	"text-clipped": (finding) =>
		`Text is clipped ${finding.detail} by a container with overflow hidden${finding.text ? ` — "${finding.text}"` : ""}. Widen the container, shorten the copy, or add \`truncate\` if cutting it off is intended. Shrinking the font is the wrong fix — it breaks the type scale to hide a layout problem.`,
	"unintended-wrap": (finding) =>
		`Control ${finding.detail}${finding.text ? ` — "${finding.text}"` : ""}. Buttons, tabs, table headers and labels are sized for one line; CJK copy is wider than the English a container was sized for. Fix in this order: shorten the copy, widen the container, or \`whitespace-nowrap\` plus \`truncate\` where clipping is acceptable.`,
	"edge-misaligned": (finding) =>
		`Row is misaligned — ${finding.detail}. A gap this small is never intentional: it is usually a missing \`items-center\`/\`items-stretch\`, or one child carrying padding the others do not.`,
};

function isRawFinding(value: unknown): value is RawFinding {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.rule === "string" &&
		typeof candidate.detail === "string" &&
		typeof candidate.text === "string" &&
		(candidate.source === null || typeof candidate.source === "string")
	);
}

/** `frames/login.tsx:42` → 文件与行号；解析不出行号时行号为 null。 */
function splitSource(source: string | null, fallbackFile: string): { file: string; line: number | null } {
	if (source === null) return { file: fallbackFile, line: null };
	const at = source.lastIndexOf(":");
	if (at < 0) return { file: source, line: null };
	const line = Number.parseInt(source.slice(at + 1), 10);
	return Number.isFinite(line) ? { file: source.slice(0, at), line } : { file: source, line: null };
}

/**
 * 把探针结果转成与源码机检同一种 issue。
 *
 * 只保留定位到**当前这一帧自己**的发现：引擎的 SPA 里 `_layout.tsx` 和 components/
 * 也在同一棵树上，把它们的问题混进来，agent 会拿着别处的报错改当前这个文件。定位
 * 不到源码的（探针向上找不到 data-vetd-source）挂回该帧文件、行号留空，总比丢掉好。
 */
export function layoutIssues(probe: unknown, frameId: string): SourceIssue[] {
	if (!Array.isArray(probe)) return [];
	const framePath = `frames/${frameId}.tsx`;
	const issues: SourceIssue[] = [];
	for (const entry of probe) {
		if (!isRawFinding(entry)) continue;
		const message = MESSAGES[entry.rule];
		if (!message) continue;
		const { file, line } = splitSource(entry.source, framePath);
		if (file !== framePath) continue;
		issues.push({ file, line, rule: entry.rule, message: message(entry) });
	}
	return issues;
}
