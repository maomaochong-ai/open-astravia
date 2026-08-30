/**
 * web-element-picker 选择器内核。
 *
 * 通过宿主 executeJavaScript 注入到 webview 页面（iife 打包，零依赖）。
 * 与 selector-main 同思路的自研实现：页面内浮层 + 点选/多选/框选/键盘导航 +
 * 指令 + 复制结构化上下文；与宿主通信走 console-message 桥（`[wep]` 前缀 JSON）。
 *
 * 说明：
 * - 本文件不得 import 任何模块（Bun.build 打成 iife 后原样注入）。
 * - 用户可见文案走内置 en/zh 词典（mount({ lang }) / applyLang），不硬编码。
 * - 键盘事件在 webview 页面内捕获——这是选择器的工作方式，不属于 App 宿主侧
 *   快捷键（App 侧键位一律走 registerShortcutScope，见方案文档）。
 */

type WepListenerFn = (event: Event) => void;
interface WepListenerEntry {
	event: string;
	fn: WepListenerFn;
	capture: boolean;
}

interface WepSelectedItem {
	element: Element;
	label: string;
	cssSelector: string;
	xpath: string;
	semanticPath: string;
	reactChain: string;
	text: string;
	instruction: string;
}

interface WepSettings {
	sharingan: boolean;
	lang: string;
}

const PREFIX = "[wep]";

const PRO_BADGE = "PRO";

// ─── 宿主桥 adapter（二期：为三期浏览器扩展形态预留可注入桥）───
//
// 内核只依赖一个 `post()` 出口上报事件。默认实现是 console-message 桥
// （桌面插件形态，与一期一致）；扩展形态在 mount() 时注入
// `{ post: (msg) => chrome.runtime.sendMessage(msg) }` 即完成换桥，
// 内核其余代码零改动。

type WepBridge = {
	post(message: unknown): void;
};

function consolePost(message: unknown): void {
	console.log(`${PREFIX}${JSON.stringify(message)}`);
}

let bridge: WepBridge = { post: consolePost };

function post(message: unknown): void {
	bridge.post(message);
}


// ─── i18n（内置词典，随宿主语言对齐）───

type WepLang = "zh" | "en";

interface WepDict {
	toolbarLabel: string;
	pausedLabel: string;
	countLabel: string;
	instruction: string;
	copy: string;
	send: string;
	exit: string;
	placeholder: string;
	cancel: string;
	ok: string;
	select: string;
	multi: string;
	nav: string;
	pause: string;
	md: string;
	contextImage: string;
	text: string;
	undo: string;
	clear: string;
	clearAll: string;
	empty: string;
	remove: string;
	settings: string;
	settingsHint: string;
	sharinganNote: string;
	report: string;
}

const DICT: Record<WepLang, WepDict> = {
	zh: {
		toolbarLabel: "选择中",
		pausedLabel: "已暂停 · F2",
		countLabel: "{n} 个元素",
		instruction: "✎ 指令",
		copy: "复制",
		send: "发送给 AI",
		exit: "退出",
		placeholder: "给这个元素写修改指令…",
		cancel: "取消",
		ok: "确定",
		select: "选择",
		multi: "多选",
		nav: "导航",
		pause: "暂停",
		md: "Markdown",
		contextImage: "提示词+图片",
		text: "文字",
		undo: "撤销",
		clear: "清除",
		clearAll: "清除全部",
		empty: "未选中元素，点击页面选取",
		remove: "移除该元素",
		settings: "设置",
		settingsHint: "打开插件设置",
		sharinganNote: "复刻模式：复制/发送输出完整 DOM、样式、字体与动画报告",
		report: "复制完整报告",
	},
	en: {
		toolbarLabel: "Picking",
		pausedLabel: "Paused · F2",
		countLabel: "{n} element(s)",
		instruction: "✎ Instruction",
		copy: "Copy",
		send: "Send to AI",
		exit: "Exit",
		placeholder: "Write an instruction for this element…",
		cancel: "Cancel",
		ok: "OK",
		select: "Select",
		multi: "Multi-select",
		nav: "Navigate",
		pause: "Pause",
		md: "Markdown",
		contextImage: "Prompt + image",
		text: "Text",
		undo: "Undo",
		clear: "Clear",
		clearAll: "Clear all",
		empty: "No elements selected, click the page to pick",
		remove: "Remove this element",
		settings: "Settings",
		settingsHint: "Open plugin settings",
		sharinganNote: "Clone mode: copy/send outputs the full DOM, styles, fonts & animations report",
		report: "Copy full report",
	},
};

// ─── 工具 ───

function clampText(text: string, max = 120): string {
	const trimmed = text.replace(/\s+/g, " ").trim();
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** 原样截断（保留换行，用于 HTML/样式/动画等结构化文本）。 */
function truncate(text: string, max = 8000): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function elementLabel(el: Element): string {
	let label = el.tagName.toLowerCase();
	if (el.id) label += `#${el.id}`;
	const classes = Array.from(el.classList).slice(0, 3);
	if (classes.length > 0) label += `.${classes.join(".")}`;
	return label;
}

/** 稳定 CSS 选择器：优先 id；否则 class+tag 链向上；兜底 nth-of-type。 */
function cssSelector(el: Element): string {
	const parts: string[] = [];
	let current: Element | null = el;
	while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
		const tag = current.tagName.toLowerCase();
		if (current.id) {
			parts.unshift(`#${CSS.escape(current.id)}`);
			break;
		}
		let part = tag;
		const classes = Array.from(current.classList)
			.filter((c) => /^[a-zA-Z0-9_-]+$/.test(c))
			.slice(0, 2);
		if (classes.length > 0) part += `.${classes.map((c) => CSS.escape(c)).join(".")}`;
		const parent: Element | null = current.parentElement;
		if (parent) {
			const siblings = Array.from(parent.children).filter(
				(s) => s.tagName === current?.tagName,
			);
			if (siblings.length > 1) {
				part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
			}
		}
		parts.unshift(part);
		current = parent;
	}
	return parts.length > 0 ? parts.join(" > ") : "html";
}

/** 绝对 XPath（按位置索引）。 */
function xpathOf(el: Element): string {
	const parts: string[] = [];
	let current: Element | null = el;
	while (current && current !== document.documentElement) {
		const parent: Element | null = current.parentElement;
		if (!parent) break;
		const siblings = Array.from(parent.children).filter((s) => s.tagName === current?.tagName);
		const index = siblings.indexOf(current) + 1;
		parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
		current = parent;
	}
	parts.unshift("html");
	return `/${parts.join("/")}`;
}

/** 语义路径：body > main > form > button。 */
function semanticPath(el: Element): string {
	const chain: string[] = [];
	let current: Element | null = el;
	while (current && current !== document.documentElement) {
		if (current.id) {
			chain.unshift(current.tagName.toLowerCase());
			break;
		}
		chain.unshift(current.tagName.toLowerCase());
		current = current.parentElement;
	}
	return chain.join(" > ");
}

/** React 组件链：沿 fiber 向上收集最近 3 个具名组件。 */
function reactChain(el: Element): string {
	const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
	if (!fiberKey) return "";
	let fiber = (el as unknown as Record<string, unknown>)[fiberKey] as
		| Record<string, unknown>
		| null
		| undefined;
	const names: string[] = [];
	let hops = 0;
	while (fiber && hops < 12) {
		const type = fiber.type;
		if (typeof type === "function") {
			const name = (type as { displayName?: string; name?: string }).displayName ??
				(type as { name?: string }).name ??
				"Anonymous";
			if (!names.includes(name)) names.push(name);
			if (names.length >= 3) break;
		}
		fiber = fiber.return as Record<string, unknown> | null | undefined;
		hops += 1;
	}
	return names.join(" > ");
}

/** 元素可见文本（保留直接文本节点 + 叶子节点文本）。 */
function elementText(el: Element): string {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const chunks: string[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const text = node.textContent?.trim();
		if (text) chunks.push(text);
	}
	if (chunks.length === 0) return clampText(el.getAttribute("aria-label") ?? "");
	return clampText(chunks.slice(0, 6).join(" "));
}

function buildContext(items: WepSelectedItem[], url: string): string {
	const blocks = items.map((item) => {
		const lines = [
			`Element: ${item.label}`,
			`CSS selector: ${item.cssSelector}`,
			`XPath: ${item.xpath}`,
			`Semantic path: ${item.semanticPath}`,
		];
		if (item.reactChain) lines.push(`React components: ${item.reactChain}`);
		if (item.text) lines.push(`Text: ${item.text}`);
		if (item.instruction) lines.push(`Instruction: ${item.instruction}`);
		return lines.join("\n");
	});
	const header = [
		"Web element context",
		`URL: ${url}`,
		`Selection: ${items.length} element${items.length > 1 ? "s" : ""}`,
	].join("\n");
	return `${header}\n\n${blocks.join("\n\n")}`;
}

function buildMarkdown(items: WepSelectedItem[]): string {
	return items
		.map((item) => {
			const lines = [`## ${item.label}`];
			lines.push(`- CSS: \`${item.cssSelector}\``);
			lines.push(`- XPath: \`${item.xpath}\``);
			lines.push(`- Path: ${item.semanticPath}`);
			if (item.reactChain) lines.push(`- React: ${item.reactChain}`);
			if (item.text) lines.push(`- Text: ${item.text}`);
			if (item.instruction) lines.push(`- Instruction: ${item.instruction}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

// ─── UI ───

const UI_STYLE_ID = "wep-ui-style";

const STYLE = `
#wep-root{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;
--wep-bg:#111827;--wep-panel:rgba(17,24,39,.96);--wep-surface:#1f2937;--wep-surface-2:#374151;
--wep-border:rgba(255,255,255,.1);--wep-text:#f9fafb;--wep-muted:#9ca3af;--wep-dim:#6b7280;
--wep-accent:#6366f1;--wep-accent-2:#4f46e5;--wep-blue:#3b82f6;--wep-violet:#8b5cf6;
--wep-danger:#7f1d1d;--wep-danger-2:#991b1b;--wep-danger-text:#fecaca;--wep-green:#34d399;--wep-amber:#f59e0b;
--wep-radius:8px;--wep-radius-sm:6px;--wep-fs-xs:11px;--wep-fs-sm:12px;--wep-fs-base:13px;
}
.wep-hover{position:fixed;border:1.5px dashed var(--wep-blue);background:rgba(59,130,246,.12);border-radius:2px;pointer-events:none;transition:all .08s ease;}
.wep-selected{position:fixed;border:2px solid var(--wep-violet);background:rgba(139,92,246,.1);border-radius:2px;pointer-events:none;}
.wep-marquee{position:fixed;border:1px solid var(--wep-blue);background:rgba(59,130,246,.16);border-radius:1px;pointer-events:none;}
/* 收起态：状态胶囊 */
.wep-cap{position:fixed;right:14px;bottom:14px;pointer-events:auto;display:none;align-items:center;gap:7px;background:var(--wep-bg);color:var(--wep-text);border:1px solid var(--wep-border);border-radius:999px;padding:7px 13px;font-size:var(--wep-fs-sm);box-shadow:0 8px 28px rgba(0,0,0,.4);cursor:pointer;z-index:2147483647;}
.wep-cap.show{display:flex;}
.wep-dot{width:8px;height:8px;border-radius:50%;background:var(--wep-green);box-shadow:0 0 8px rgba(52,211,153,.8);flex:none;}
.wep-dot.paused{background:var(--wep-amber);box-shadow:0 0 8px rgba(245,158,11,.8);}
.wep-pro{font-size:var(--wep-fs-xs);font-weight:700;letter-spacing:.06em;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border-radius:4px;padding:1px 5px;flex:none;}
.wep-count{color:#a5b4fc;font-weight:700;font-variant-numeric:tabular-nums;font-size:var(--wep-fs-sm);}
/* 展开态：命令面板 */
.wep-panel{position:fixed;right:14px;bottom:14px;pointer-events:auto;width:272px;max-height:min(540px,calc(100vh - 28px));background:var(--wep-panel);color:var(--wep-text);border:1px solid var(--wep-border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:2147483647;display:none;overflow-y:auto;}
.wep-panel.open{display:block;}
.wep-header{display:flex;align-items:center;gap:6px;padding:9px 8px 9px 12px;border-bottom:1px solid var(--wep-border);position:sticky;top:0;background:var(--wep-panel);}
.wep-header-title{display:flex;align-items:center;gap:6px;font-size:var(--wep-fs-sm);font-weight:600;flex:1;min-width:0;}
.wep-head-btn{background:transparent;border:0;color:var(--wep-muted);font-size:var(--wep-fs-base);line-height:1;cursor:pointer;padding:3px 6px;border-radius:var(--wep-radius-sm);font-family:inherit;}
.wep-head-btn:hover{color:var(--wep-text);background:rgba(255,255,255,.08);}
/* 复刻模式提示条 */
.wep-note{padding:5px 12px;font-size:var(--wep-fs-xs);color:#a5b4fc;border-bottom:1px solid var(--wep-border);}
/* 选中元素列表 */
.wep-items{padding:6px 8px 2px;display:flex;flex-direction:column;gap:3px;max-height:150px;overflow-y:auto;}
.wep-item{display:flex;align-items:center;gap:6px;background:var(--wep-surface);border:1px solid transparent;border-radius:var(--wep-radius-sm);padding:3px 4px 3px 7px;font-size:var(--wep-fs-xs);color:#d1d5db;cursor:pointer;}
.wep-item:hover{border-color:var(--wep-border);background:var(--wep-surface-2);}
.wep-item-idx{color:var(--wep-dim);font-variant-numeric:tabular-nums;flex:none;}
.wep-item-label{font-weight:600;color:var(--wep-text);flex:none;}
.wep-item-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#d1d5db;}
.wep-item-rm{background:transparent;border:0;color:var(--wep-dim);font-size:var(--wep-fs-sm);line-height:1;cursor:pointer;padding:2px 4px;border-radius:4px;font-family:inherit;}
.wep-item-rm:hover{color:var(--wep-danger-text);background:var(--wep-danger);}
.wep-items-foot{display:flex;justify-content:flex-end;padding:2px 8px 4px;}
.wep-empty{padding:8px 4px 2px;font-size:var(--wep-fs-xs);color:var(--wep-dim);text-align:center;}
/* 快捷键网格 */
.wep-kbd{padding:8px 10px 4px;display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;}
.wep-kbd-item{display:flex;align-items:center;gap:6px;font-size:var(--wep-fs-xs);color:#d1d5db;white-space:nowrap;}
.wep-kbd-item kbd{background:var(--wep-surface);border:1px solid #374151;border-bottom-width:2px;border-radius:4px;padding:1px 5px;font-family:inherit;font-size:var(--wep-fs-xs);color:#e5e7eb;min-width:20px;text-align:center;}
/* 操作按钮（面板与 popover 共用） */
.wep-actions{display:flex;gap:6px;padding:6px 10px 10px;border-top:1px solid var(--wep-border);margin-top:6px;position:sticky;bottom:0;background:var(--wep-panel);}
.wep-btn{flex:1;background:var(--wep-surface);border:0;color:var(--wep-text);border-radius:var(--wep-radius-sm);padding:5px 8px;font-size:var(--wep-fs-xs);cursor:pointer;font-family:inherit;text-align:center;white-space:nowrap;}
.wep-btn:hover{background:var(--wep-surface-2);}
.wep-btn.primary{background:var(--wep-accent);}
.wep-btn.primary:hover{background:var(--wep-accent-2);}
.wep-btn.danger{background:var(--wep-danger);color:var(--wep-danger-text);}
.wep-btn.danger:hover{background:var(--wep-danger-2);}
.wep-btn:disabled{opacity:.4;cursor:default;}
.wep-popover{position:fixed;pointer-events:auto;background:var(--wep-bg);color:var(--wep-text);border:1px solid var(--wep-border);border-radius:var(--wep-radius);padding:10px;font-size:var(--wep-fs-base);box-shadow:0 6px 24px rgba(0,0,0,.4);z-index:2147483647;width:280px;display:flex;flex-direction:column;gap:8px;}
.wep-popover textarea{background:var(--wep-surface);border:1px solid var(--wep-border);color:var(--wep-text);border-radius:var(--wep-radius-sm);padding:6px;font-size:var(--wep-fs-sm);font-family:inherit;resize:none;min-height:52px;outline:none;}
.wep-popover textarea:focus{border-color:var(--wep-blue);}
.wep-pop-actions{display:flex;justify-content:flex-end;gap:6px;}
.wep-pop-actions .wep-btn{flex:none;padding:3px 10px;font-size:var(--wep-fs-sm);}
.wep-pop-actions .wep-btn.primary{background:var(--wep-blue);}
`;

interface WepUi {
	root: HTMLDivElement;
	hover: HTMLDivElement;
	selectedBoxes: Map<Element, HTMLDivElement>;
	marquee: HTMLDivElement | null;
	// 收起态：右下角状态胶囊。
	cap: HTMLDivElement;
	capDot: HTMLSpanElement;
	capLabel: HTMLSpanElement;
	capCount: HTMLSpanElement;
	// 展开态：命令面板。
	panel: HTMLDivElement;
	headerTitle: HTMLSpanElement;
	titleText: HTMLSpanElement;
	countLabel: HTMLSpanElement;
	settingsBtn: HTMLButtonElement;
	note: HTMLDivElement;
	itemsList: HTMLDivElement;
	itemsFoot: HTMLDivElement;
	clearAllBtn: HTMLButtonElement;
	instructionBtn: HTMLButtonElement;
	copyBtn: HTMLButtonElement;
	sendBtn: HTMLButtonElement;
	exitBtn: HTMLButtonElement;
	popover: HTMLDivElement | null;
	popoverTarget: Element | null;
}

const KBD_ITEMS: Array<{ key: string; labelKey: keyof WepDict }> = [
	{ key: "Click", labelKey: "select" },
	{ key: "⇧", labelKey: "multi" },
	{ key: "←↑→↓", labelKey: "nav" },
	{ key: "F2", labelKey: "pause" },
	{ key: "⌘C", labelKey: "copy" },
	{ key: "⌘⇧C", labelKey: "text" },
	{ key: "⌘⇧I", labelKey: "contextImage" },
	{ key: "⌘M", labelKey: "md" },
	{ key: "⌘Z", labelKey: "undo" },
	{ key: "Esc", labelKey: "clear" },
];

function createUi(dict: WepDict): WepUi {
	if (!document.getElementById(UI_STYLE_ID)) {
		const style = document.createElement("style");
		style.id = UI_STYLE_ID;
		style.textContent = STYLE;
		document.head.appendChild(style);
	}
	const root = document.createElement("div");
	root.id = "wep-root";
	const hover = document.createElement("div");
	hover.className = "wep-hover";
	hover.style.display = "none";

	// 收起态：右下角状态胶囊。
	const cap = document.createElement("div");
	cap.className = "wep-cap";
	const capDot = document.createElement("span");
	capDot.className = "wep-dot";
	const capLabel = document.createElement("span");
	capLabel.textContent = dict.toolbarLabel;
	const proBadge = document.createElement("span");
	proBadge.className = "wep-pro";
	proBadge.textContent = PRO_BADGE;
	const capCount = document.createElement("span");
	capCount.className = "wep-count";
	capCount.textContent = "0";
	cap.append(capDot, capLabel, proBadge, capCount);

	// 展开态：命令面板（header + 复刻提示 + 元素列表 + 快捷键网格 + 操作按钮）。
	const panel = document.createElement("div");
	panel.className = "wep-panel";
	const header = document.createElement("div");
	header.className = "wep-header";
	const headerTitle = document.createElement("span");
	headerTitle.className = "wep-header-title";
	const titleDot = document.createElement("span");
	titleDot.className = "wep-dot";
	const titleLabel = document.createElement("span");
	titleLabel.textContent = dict.toolbarLabel;
	const panelPro = document.createElement("span");
	panelPro.className = "wep-pro";
	panelPro.textContent = PRO_BADGE;
	headerTitle.append(titleDot, titleLabel, panelPro);
	const count = document.createElement("span");
	count.className = "wep-count";
	const settingsBtn = document.createElement("button");
	settingsBtn.type = "button";
	settingsBtn.className = "wep-head-btn";
	settingsBtn.dataset.action = "settings";
	settingsBtn.title = dict.settingsHint;
	settingsBtn.textContent = "⚙";
	const collapseBtn = document.createElement("button");
	collapseBtn.type = "button";
	collapseBtn.className = "wep-head-btn";
	collapseBtn.dataset.action = "collapse";
	collapseBtn.textContent = "−";
	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.className = "wep-head-btn";
	closeBtn.dataset.action = "close";
	closeBtn.textContent = "✕";
	header.append(headerTitle, count, settingsBtn, collapseBtn, closeBtn);

	// 复刻模式提示条（sharingan 开启时显示）。
	const note = document.createElement("div");
	note.className = "wep-note";
	note.style.display = "none";

	// 选中元素信息列表（标签 + 文本摘要 + 单删）与清除全部。
	const itemsList = document.createElement("div");
	itemsList.className = "wep-items";
	const itemsFoot = document.createElement("div");
	itemsFoot.className = "wep-items-foot";
	const clearAllBtn = document.createElement("button");
	clearAllBtn.type = "button";
	clearAllBtn.className = "wep-btn";
	clearAllBtn.style.flex = "none";
	clearAllBtn.style.padding = "2px 8px";
	clearAllBtn.textContent = dict.clearAll;
	itemsFoot.appendChild(clearAllBtn);

	const kbd = document.createElement("div");
	kbd.className = "wep-kbd";
	for (const item of KBD_ITEMS) {
		const row = document.createElement("div");
		row.className = "wep-kbd-item";
		const key = document.createElement("kbd");
		key.textContent = item.key;
		const label = document.createElement("span");
		label.textContent = dict[item.labelKey];
		row.append(key, label);
		kbd.appendChild(row);
	}

	const actions = document.createElement("div");
	actions.className = "wep-actions";
	const instructionBtn = document.createElement("button");
	instructionBtn.type = "button";
	instructionBtn.className = "wep-btn";
	instructionBtn.textContent = dict.instruction;
	const copyBtn = document.createElement("button");
	copyBtn.type = "button";
	copyBtn.className = "wep-btn";
	copyBtn.textContent = dict.copy;
	const sendBtn = document.createElement("button");
	sendBtn.type = "button";
	sendBtn.className = "wep-btn primary";
	sendBtn.textContent = dict.send;
	const exitBtn = document.createElement("button");
	exitBtn.type = "button"
	exitBtn.className = "wep-btn danger";
	exitBtn.textContent = dict.exit;
	actions.append(instructionBtn, copyBtn, sendBtn, exitBtn);

	panel.append(header, note, itemsList, itemsFoot, kbd, actions);
	root.append(hover, cap, panel);
	document.documentElement.appendChild(root);
	return {
		root,
		hover,
		selectedBoxes: new Map<Element, HTMLDivElement>(),
		marquee: null,
		cap,
		capDot,
		capLabel,
		capCount,
		panel,
		headerTitle,
		titleText: titleLabel,
		countLabel: count,
		settingsBtn,
		note,
		itemsList,
		itemsFoot,
		clearAllBtn,
		instructionBtn,
		copyBtn,
		sendBtn,
		exitBtn,
		popover: null,
		popoverTarget: null,
	};
}

// ─── 状态 ───

interface WepDrag {
	active: boolean;
	startX: number;
	startY: number;
	add: boolean;
}

interface WepState {
	active: boolean;
	paused: boolean;
	collapsed: boolean;
	selected: Element[];
	hovered: Element | null;
	history: Element[][];
	instructions: Map<Element, string>;
	ui: WepUi;
	settings: WepSettings;
	lang: WepLang;
	suppressClick: boolean;
	drag: WepDrag | null;
	listeners: WepListenerEntry[];
}

let state: WepState | null = null;

function dictOf(): WepDict {
	const lang: WepLang = state?.lang === "en" ? "en" : "zh";
	return DICT[lang];
}

/** 刷新选中框、元素列表与命令面板（标题/计数/暂停态/展开态/按钮可用性）。 */
function updatePanel(): void {
	if (!state) return;
	const { ui, selected } = state;
	const dict = dictOf();
	for (const box of ui.selectedBoxes.values()) box.remove();
	ui.selectedBoxes.clear();
	for (const el of selected) {
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) continue;
		const box = document.createElement("div");
		box.className = "wep-selected";
		box.style.left = `${rect.left}px`;
		box.style.top = `${rect.top}px`;
		box.style.width = `${rect.width}px`;
		box.style.height = `${rect.height}px`;
		ui.root.appendChild(box);
		ui.selectedBoxes.set(el, box);
	}
	const label = state.paused ? dict.pausedLabel : dict.toolbarLabel;
	const countText = dict.countLabel.replace("{n}", String(selected.length));
	ui.titleText.textContent = label;
	ui.capLabel.textContent = label;
	ui.countLabel.textContent = countText;
	ui.capCount.textContent = String(selected.length);
	ui.capDot.classList.toggle("paused", state.paused);
	const hasSelection = selected.length > 0;
	ui.instructionBtn.disabled = !hasSelection;
	ui.copyBtn.disabled = !hasSelection;
	ui.sendBtn.disabled = !hasSelection;
	ui.cap.classList.toggle("show", state.collapsed);
	ui.panel.classList.toggle("open", !state.collapsed);
	// 复刻模式：提示条 + 复制按钮切换为「复制完整报告」入口。
	ui.note.style.display = state.settings.sharingan ? "block" : "none";
	ui.note.textContent = dict.sharinganNote;
	ui.copyBtn.textContent = state.settings.sharingan ? dict.report : dict.copy;
	renderItems();
	post({ type: "selection-changed", count: selected.length });
}

/** 渲染选中元素信息列表（对齐快捷面板）：序号 + 标签 + 文本摘要 + 单删 + 清除全部。 */
function renderItems(): void {
	if (!state) return;
	const { ui, selected } = state;
	const dict = dictOf();
	ui.itemsList.textContent = "";
	if (selected.length === 0) {
		const empty = document.createElement("div");
		empty.className = "wep-empty";
		empty.textContent = dict.empty;
		ui.itemsList.appendChild(empty);
		ui.itemsFoot.style.display = "none";
		return;
	}
	ui.itemsFoot.style.display = "flex";
	selected.forEach((el, index) => {
		const row = document.createElement("div");
		row.className = "wep-item";
		const idx = document.createElement("span");
		idx.className = "wep-item-idx";
		idx.textContent = String(index + 1);
		const label = document.createElement("span");
		label.className = "wep-item-label";
		label.textContent = elementLabel(el);
		const text = document.createElement("span");
		text.className = "wep-item-text";
		text.textContent = `"${elementText(el)}"`;
		const rm = document.createElement("button");
		rm.type = "button";
		rm.className = "wep-item-rm";
		rm.title = dict.remove;
		rm.textContent = "✕";
		rm.addEventListener("click", (e) => {
			e.stopPropagation();
			removeSelected(el);
		});
		row.append(idx, label, text, rm);
		// 点击行：聚焦该元素（滚动到视口并高亮），不改变选择。
		row.addEventListener("click", () => {
			el.scrollIntoView({ block: "nearest", behavior: "smooth" });
			hoverElement(el);
		});
		ui.itemsList.appendChild(row);
	});
}

/** 移除单个选中元素（可撤销）。 */
function removeSelected(el: Element): void {
	if (!state) return;
	state.history.push([...state.selected]);
	state.selected = state.selected.filter((x) => x !== el);
	updatePanel();
}

function positionHover(el: Element): void {
	if (!state) return;
	const rect = el.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) {
		state.ui.hover.style.display = "none";
		return;
	}
	state.ui.hover.style.display = "block";
	state.ui.hover.style.left = `${rect.left}px`;
	state.ui.hover.style.top = `${rect.top}px`;
	state.ui.hover.style.width = `${rect.width}px`;
	state.ui.hover.style.height = `${rect.height}px`;
}

function hoverElement(el: Element | null): void {
	if (!state) return;
	state.hovered = el;
	if (el) positionHover(el);
	else state.ui.hover.style.display = "none";
}


// ─── 视口变化刷新（滚动/缩放重算浮层位置）───
//
// hover 框与选中框都是 fixed 定位 + 视口坐标（getBoundingClientRect），
// 页面滚动后元素在视口中的位置已变，若不重算框会停留在旧坐标（“飘逸”）。
// scroll 不冒泡，但 capture 阶段可捕获 document 及所有后代容器的滚动。

let viewportRaf = 0;

/** 滚动/缩放后重算 hover 框与所有选中框；rAF 节流避免滚动风暴触发频繁 reflow。 */
function refreshOverlays(): void {
	if (!state) return;
	const { ui, selected, hovered } = state;
	if (hovered && ui.hover.style.display !== "none") positionHover(hovered);
	for (const el of selected) {
		const box = ui.selectedBoxes.get(el);
		if (!box) continue;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			// 元素滚出视口（display:none 或不可见）：隐藏框，回到视口时再恢复。
			box.style.display = "none";
			continue;
		}
		box.style.display = "block";
		box.style.left = `${rect.left}px`;
		box.style.top = `${rect.top}px`;
		box.style.width = `${rect.width}px`;
		box.style.height = `${rect.height}px`;
	}
}

function onViewportChange(): void {
	if (viewportRaf) return;
	viewportRaf = requestAnimationFrame(() => {
		viewportRaf = 0;
		refreshOverlays();
	});
}

// ─── 指令 popover ───

function openPopover(target: Element): void {
	if (!state) return;
	closePopover();
	const dict = dictOf();
	const existing = state.instructions.get(target) ?? "";
	const rect = target.getBoundingClientRect();
	const pop = document.createElement("div");
	pop.className = "wep-popover";
	const textarea = document.createElement("textarea");
	textarea.placeholder = dict.placeholder;
	textarea.value = existing;
	const actions = document.createElement("div");
	actions.className = "wep-pop-actions";
	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.className = "wep-btn";
	cancel.textContent = dict.cancel;
	const ok = document.createElement("button");
	ok.type = "button";
	ok.className = "wep-btn primary";
	ok.textContent = dict.ok;
	actions.append(cancel, ok);
	pop.append(textarea, actions);
	state.ui.root.appendChild(pop);
	state.ui.popover = pop;
	state.ui.popoverTarget = target;
	const left = Math.min(rect.left, window.innerWidth - 300);
	const top = rect.bottom + 8 > window.innerHeight - 60 ? rect.top - pop.offsetHeight - 8 : rect.bottom + 8;
	pop.style.left = `${Math.max(8, left)}px`;
	pop.style.top = `${Math.max(8, top)}px`;
	textarea.focus();
	const done = () => {
		closePopover();
		updatePanel();
	};
	cancel.addEventListener("click", done);
	ok.addEventListener("click", () => {
		const instruction = textarea.value.trim();
		if (instruction && state) {
			state.instructions.set(target, instruction);
		}
		done();
	});
}

function closePopover(): void {
	if (!state) return;
	state.ui.popover?.remove();
	state.ui.popover = null;
	state.ui.popoverTarget = null;
}

// ─── 上下文收集 ───

function collectItem(el: Element): WepSelectedItem | null {
	return {
		element: el,
		label: elementLabel(el),
		cssSelector: cssSelector(el),
		xpath: xpathOf(el),
		semanticPath: semanticPath(el),
		reactChain: reactChain(el),
		text: elementText(el),
		instruction: state?.instructions.get(el) ?? "",
	};
}

function buildSelectionContext(): string {
	if (!state) return "";
	const items = state.selected.map((el) => collectItem(el)).filter((i): i is WepSelectedItem => i !== null);
	return buildContext(items, location.href);
}


function copyMarkdown(): void {
	if (!state) return;
	const items = state.selected.map((el) => collectItem(el)).filter((i): i is WepSelectedItem => i !== null);
	const text = buildMarkdown(items);
	if (!text) return;
	post({ type: "copy", text, mime: "text/markdown" });
	void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** 遍历文档样式表收集规则源码（跨域样式表静默跳过）。 */
function collectCssRules(match: (rule: CSSRule) => string | null): string[] {
	const out: string[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // 跨域样式表无权限读取
		}
		for (const rule of Array.from(rules)) {
			const text = match(rule);
			if (text) out.push(text);
		}
	}
	return out;
}

/** 文档内全部 @font-face 规则源码（字体）。 */
function collectFontFaces(): string {
	return collectCssRules((rule) => (rule instanceof CSSFontFaceRule ? rule.cssText : null)).join("\n");
}

/** 文档内全部 @keyframes 定义源码（动画）。 */
function collectKeyframes(): string {
	return collectCssRules((rule) => (rule instanceof CSSKeyframesRule ? rule.cssText : null)).join("\n");
}

/** Sharingan 模式：输出高保真复刻报告（完整 DOM + 全量生效样式 + 字体 + 动画 + React 链）。 */
function buildSharinganReport(): string {
	if (!state) return "";
	const fontFaces = collectFontFaces();
	const keyframes = collectKeyframes();
	const blocks = state.selected.map((el) => {
		const cs = getComputedStyle(el);
		const styles = Array.from(cs)
			.map((k) => `  ${k}: ${cs.getPropertyValue(k)}`)
			.join("\n");
		const animProps = [
			"animationName",
			"animationDuration",
			"animationTimingFunction",
			"animationDelay",
			"animationIterationCount",
			"animationDirection",
			"animationFillMode",
			"animationPlayState",
		]
			.filter((k) => cs.getPropertyValue(k) !== "")
			.map((k) => `  ${k}: ${cs.getPropertyValue(k)}`)
			.join("\n");
		const html = truncate(el.outerHTML, 6000);
		const chain = reactChain(el);
		const inline = el.getAttribute("style");
		return [
			`## ${elementLabel(el)}`,
			``,
			`CSS selector: ${cssSelector(el)}`,
			`Semantic path: ${semanticPath(el)}`,
			chain ? `React components: ${chain}` : "",
			``,
			`### Full DOM`,
			``,
			html,
			``,
			`### Inline styles`,
			``,
			inline || "—",
			``,
			`### Computed styles`,
			``,
			truncate(styles, 8000),
			``,
			`### Fonts`,
			``,
			`font-family: ${cs.fontFamily}`,
			``,
			`### Animations`,
			``,
			animProps || "  none",
		]
			.filter((line) => line !== "")
			.join("\n");
	});
	return [
		`# Web Element Recreation Report`,
		`URL: ${location.href}`,
		`Generated: ${new Date().toISOString()}`,
		``,
		blocks.join("\n\n---\n\n"),
		fontFaces ? `\n## @font-face rules\n\n${fontFaces}` : "",
		keyframes ? `\n## @keyframes\n\n${truncate(keyframes, 8000)}` : "",
	]
		.filter((line) => line !== "")
		.join("\n");
}

function copyContext(): void {
	const text = state?.settings.sharingan ? buildSharinganReport() : buildSelectionContext();
	if (!text) return;
	// 优先走宿主桥（宿主接管剪贴板，见方案 §5.4）；内核直写为兜底。
	post({ type: "copy", text, mime: "text/plain" });
	void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** 复制选中元素可见文字（对齐「复制文字」：选中框里可见的准确文字）。 */
function copyText(): void {
	if (!state) return;
	const items = state.selected
		.map((el) => {
			const t = elementText(el);
			return t ? `${elementLabel(el)}: ${t}` : elementLabel(el);
		})
		.join("\n");
	if (!items) return;
	post({ type: "copy", text: items, mime: "text/plain" });
	void navigator.clipboard?.writeText(items).catch(() => undefined);
}

function sendToAi(): void {
	const text = state?.settings.sharingan ? buildSharinganReport() : buildSelectionContext();
	if (!text) return;
	post({ type: "send-to-ai", text });
}

function screenshotSelection(): void {
	if (!state) return;
	let rect: { x: number; y: number; width: number; height: number } | undefined;
	// 多选时截全部选中元素的合并边界框；裁剪到视口内，避免负坐标/越界。
	const visible = state.selected.filter((el) => {
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	});
	if (visible.length > 0) {
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (const el of visible) {
			const r = el.getBoundingClientRect();
			left = Math.min(left, r.left);
			top = Math.min(top, r.top);
			right = Math.max(right, r.right);
			bottom = Math.max(bottom, r.bottom);
		}
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const x = Math.max(0, Math.round(left));
		const y = Math.max(0, Math.round(top));
		const w = Math.min(vw, Math.round(right)) - x;
		const h = Math.min(vh, Math.round(bottom)) - y;
		if (w > 0 && h > 0) rect = { x, y, width: w, height: h };
	}
	post({ type: "screenshot", rect });
}
// ─── 事件 ───

const MARQUEE_STEP = 24;

/** 矩形采样：返回与框选矩形相交的可见元素（排除浮层自身）。 */
function elementsInRect(rect: { left: number; top: number; right: number; bottom: number }): Element[] {
	const seen = new Set<Element>();
	const result: Element[] = [];
	for (let y = rect.top; y <= rect.bottom; y += MARQUEE_STEP) {
		for (let x = rect.left; x <= rect.right; x += MARQUEE_STEP) {
			for (const el of document.elementsFromPoint(x, y)) {
				if (!(el instanceof Element)) continue;
				if (el === document.documentElement || el === document.body) continue;
				if (el.closest("#wep-root")) continue;
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0 || seen.has(el)) continue;
				seen.add(el);
				result.push(el);
			}
		}
	}
	return result;
}

function onPointerDown(event: Event): void {
	if (!state || state.paused || state.ui.popover) return;
	const e = event as PointerEvent;
	if (e.button !== 0) return;
	const target = e.target as Element | null;
	if (!target || target.closest("#wep-root")) return;
	state.drag = { active: false, startX: e.clientX, startY: e.clientY, add: e.shiftKey };
}

function updateMarquee(x: number, y: number): void {
	if (!state || !state.drag || !state.ui.marquee) return;
	const left = Math.min(state.drag.startX, x);
	const top = Math.min(state.drag.startY, y);
	state.ui.marquee.style.left = `${left}px`;
	state.ui.marquee.style.top = `${top}px`;
	state.ui.marquee.style.width = `${Math.abs(x - state.drag.startX)}px`;
	state.ui.marquee.style.height = `${Math.abs(y - state.drag.startY)}px`;
}

function onPointerMove(event: Event): void {
	if (!state || !state.drag) return;
	const e = event as PointerEvent;
	if (!state.drag.active) {
		const { startX, startY } = state.drag;
		if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) return;
		state.drag.active = true;
		const box = document.createElement("div");
		box.className = "wep-marquee";
		state.ui.root.appendChild(box);
		state.ui.marquee = box;
		e.preventDefault();
	}
	updateMarquee(e.clientX, e.clientY);
}

function onPointerUp(event: Event): void {
	if (!state || !state.drag) return;
	const e = event as PointerEvent;
	const drag = state.drag;
	state.drag = null;
	if (!drag.active) return;
	e.preventDefault();
	state.ui.marquee?.remove();
	state.ui.marquee = null;
	const left = Math.min(drag.startX, e.clientX);
	const top = Math.min(drag.startY, e.clientY);
	const right = Math.max(drag.startX, e.clientX);
	const bottom = Math.max(drag.startY, e.clientY);
	const els = elementsInRect({ left, top, right, bottom });
	if (els.length > 0) {
		state.history.push([...state.selected]);
		state.selected = drag.add ? Array.from(new Set([...state.selected, ...els])) : els;
		updatePanel();
	}
	state.suppressClick = true;
}

function onPointerOver(event: Event): void {
	if (!state || state.paused || state.ui.popover) return;
	if (state.drag?.active) return;
	const target = event.target as Element | null;
	if (target && target !== state.ui.root && target.closest("#wep-root") === null) {
		hoverElement(target);
	}
}

function onClick(event: Event): void {
	if (!state || state.paused) return;
	if (state.suppressClick) {
		state.suppressClick = false;
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	const e = event as MouseEvent;
	const target = e.target as Element | null;
	// 指令 popover 打开期间：点击面板外仅关闭 popover，不再改选/跳转；点击面板内直接忽略。
	if (state.ui.popover) {
		if (target && target.closest("#wep-root")) return;
		closePopover();
		return;
	}
	if (!target || target.closest("#wep-root")) return;
	e.preventDefault();
	e.stopPropagation();
	if (e.shiftKey) {
		state.history.push([...state.selected]);
		const index = state.selected.indexOf(target);
		if (index >= 0) state.selected.splice(index, 1);
		else state.selected.push(target);
		updatePanel();
	} else {
		state.history.push([...state.selected]);
		state.selected = [target];
		updatePanel();
	}
}

function onKeyDown(event: Event): void {
	if (!state) return;
	const { selected, ui } = state;
	const e = event as KeyboardEvent;
	const inTextarea = (e.target as HTMLElement | null)?.tagName === "TEXTAREA";
	// popover 打开期间只放行 textarea 输入与 Esc 关闭，其余快捷键（含 F2/方向键/复制）不响应。
	if (ui.popover) {
		if (inTextarea) return;
		if (e.key === "Escape") {
			e.preventDefault();
			closePopover();
		}
		return;
	}
	if (e.key === "Escape") {
		if (selected.length > 0) {
			state.history.push([...selected]);
			selected.length = 0;
			updatePanel();
		} else {
			destroy();
		}
		return;
	}
	if (e.key === "F2") {
		e.preventDefault();
		state.paused = !state.paused;
		hoverElement(null);
		updatePanel();
		return;
	}
	// ⌘⇧I：复制提示词 + 选区截图（上下文照常复制，同时触发截图保存并挂附件）。
	if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") {
		e.preventDefault();
		copyContext();
		screenshotSelection();
		return;
	}
	// ⌘⇧C：复制选中元素可见文字。
	if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c") {
		e.preventDefault();
		copyText();
		return;
	}
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
		e.preventDefault();
		copyContext();
		return;
	}
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
		e.preventDefault();
		copyMarkdown();
		return;
	}
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
		e.preventDefault();
		const prev = state.history.pop();
		if (prev) {
			state.selected = prev;
			updatePanel();
		}
		return;
	}
	if (e.metaKey || e.ctrlKey || e.altKey) return;

	if (selected.length === 0) return;
	const current = selected[selected.length - 1];
	let next: Element | null = null;
	switch (e.key) {
		case "ArrowUp":
			next = current.parentElement;
			break;
		case "ArrowDown":
			next = current.firstElementChild;
			break;
		case "ArrowLeft":
			next = current.previousElementSibling;
			break;
		case "ArrowRight":
			next = current.nextElementSibling;
			break;
	}
	if (next && next !== state.ui.root) {
		e.preventDefault();
		state.history.push([...selected]);
		state.selected = [next];
		updatePanel();
		hoverElement(next);
	}
}

function onToolbarAction(action: string): void {
	if (!state) return;
	switch (action) {
		case "instruction": {
			const target = state.selected[state.selected.length - 1];
			if (target) openPopover(target);
			break;
		}
		case "copy":
			copyContext();
			break;
		case "send":
			sendToAi();
			break;
		case "exit":
			destroy();
			break;
	}
}


/** 绑定命令面板交互：胶囊展开、面板折叠/关闭、操作按钮。 */
function bindPanel(): void {
	if (!state) return;
	const { ui } = state;
	ui.cap.addEventListener("click", () => {
		if (!state) return;
		state.collapsed = false;
		updatePanel();
	});
	ui.panel.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
		if (!state) return;
		state.collapsed = true;
		updatePanel();
	});
	ui.panel.querySelector('[data-action="close"]')?.addEventListener("click", () => destroy());
	ui.panel.querySelector('[data-action="settings"]')?.addEventListener("click", () => post({ type: "open-settings" }));
	ui.clearAllBtn.addEventListener("click", () => {
		if (!state || state.selected.length === 0) return;
		state.history.push([...state.selected]);
		state.selected = [];
		updatePanel();
	});
	ui.instructionBtn.addEventListener("click", () => onToolbarAction("instruction"));
	ui.copyBtn.addEventListener("click", () => onToolbarAction("copy"));
	ui.sendBtn.addEventListener("click", () => onToolbarAction("send"));
	ui.exitBtn.addEventListener("click", () => onToolbarAction("exit"));
}

// ─── 生命周期 ───

function mount(options?: { lang?: string; bridge?: WepBridge }): void {
	if (state) return;
	if (options?.bridge) bridge = options.bridge;
	const lang: WepLang = options?.lang === "en" ? "en" : "zh";
	let ui: WepUi;
	try {
		ui = createUi(DICT[lang]);
	} catch (error) {
		// UI 构建失败（如文档尚未就绪）：不留任何残留，宿主收到 mount-failed 提示。
		post({ type: "mount-failed" });
		console.warn("[wep] mount createUi failed:", error);
		return;
	}
	state = {
		active: true,
		paused: false,
		selected: [],
		hovered: null,
		history: [],
		instructions: new Map<Element, string>(),
		settings: { sharingan: false, lang },
		ui,
		lang,
		suppressClick: false,
		collapsed: true,
		drag: null,
		listeners: [],
	};
	const add = (event: string, fn: WepListenerFn, capture = true) => {
		document.addEventListener(event, fn as EventListener, capture);
		state?.listeners.push({ event, fn, capture });
	};
	add("pointerdown", onPointerDown);
	add("pointermove", onPointerMove);
	add("pointerup", onPointerUp);
	add("pointerover", onPointerOver);
	add("click", onClick, true);
	add("keydown", onKeyDown, true);
	add("scroll", onViewportChange, true);
	window.addEventListener("resize", onViewportChange);
	try {
		bindPanel();
		updatePanel();
	} catch (error) {
		// 半初始化失败必须完整回滚：移除已挂监听与 UI，避免“内核仍拦截点击、
		// 宿主却不知道已激活”的僵尸态（表现为页面点击无响应）。
		for (const entry of state.listeners) {
			document.removeEventListener(entry.event, entry.fn as EventListener, entry.capture);
		}
		window.removeEventListener("resize", onViewportChange);
		state.ui.root.remove();
		state = null;
		post({ type: "mount-failed" });
		console.warn("[wep] mount setup failed:", error);
		return;
	}
	post({ type: "mounted" });
	// 选择模式标记：页面脚本可感知当前处于选择态（点击归内核处理）。
	(window as unknown as Record<string, unknown>).__WEP_ACTIVE__ = true;
}

function destroy(): void {
	if (!state) return;
	for (const entry of state.listeners) {
		document.removeEventListener(entry.event, entry.fn as EventListener, entry.capture);
	}
	window.removeEventListener("resize", onViewportChange);
	state.ui.root.remove();
	state = null;
	post({ type: "destroyed" });
	(window as unknown as Record<string, unknown>).__WEP_ACTIVE__ = false;
}

function applyLang(lang: string): void {
	if (!state) return;
	state.lang = lang === "en" ? "en" : "zh";
	// 文案按词典重建 UI（保持选择状态与折叠/展开状态）。
	// 重建失败（如文档正被替换）时保留旧 UI 与旧监听，避免内核半活。
	const ui = state.ui;
	let next: WepUi;
	try {
		next = createUi(dictOf());
	} catch (error) {
		console.warn("[wep] applyLang rebuild failed:", error);
		return;
	}
	ui.root.remove();
	ui.selectedBoxes.clear();
	state.ui = next;
	bindPanel();
	updatePanel();
	// 重建后浮层已按新位置定位，立即重算一次（兜底，避免新旧 rect 残留）。
	refreshOverlays();
}

function applySettings(settings: Partial<WepSettings>): void {
	if (!state) return;
	state.settings = { ...state.settings, ...settings };
	updatePanel();
}

const api = { mount, destroy, applyLang, applySettings, getContext: buildSelectionContext };
Object.defineProperty(window, "__WEP__", { value: api, configurable: true });
