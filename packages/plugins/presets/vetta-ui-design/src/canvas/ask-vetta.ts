import type { DesignSession } from "../vetd/design-session";
import type { SelectedElementPayload } from "./bridge-client";

export interface AskShot {
	frameId: string;
	screenshotPath: string;
}

export interface AskTarget {
	/** Captured frames, in canvas order. Empty = the ask targets the whole design. */
	shots: AskShot[];
	/** Set when the user drilled into one element; its frame is also in `shots`. */
	dom: { frameId: string; payload: SelectedElementPayload } | null;
}

/**
 * 这条 prompt 里嵌着用户自己敲的诉求，周边文案跟它同语言才不违和。刻意不进
 * locales/*.json —— 那是 UI 文案的 catalog，这里是发给模型的协议串，两者的取舍
 * 标准不同。
 */
interface AskCopy {
	askDom: (title: string, tag: string, suggestion: string) => string;
	askFrame: (title: string, suggestion: string) => string;
	askFrames: (count: number, suggestion: string) => string;
	askDesign: (suggestion: string) => string;
	metaHeader: string;
	designDoc: (path: string) => string;
	sourcesDir: (path: string) => string;
	frameLine: (title: string, file: string, size: string, which: string) => string;
	frameSize: (width: number, height: number) => string;
	whichShot: (index: number) => string;
	existingFrames: (list: string) => string;
	frameEntry: (id: string, title: string) => string;
	frameSeparator: string;
	noFrames: string;
	noSelection: string;
	sourceLocation: (path: string) => string;
	noSourceLocation: string;
	element: (tag: string) => string;
	domPath: (path: string) => string;
	classes: (value: string) => string;
	text: (value: string) => string;
	renderedSize: (width: number, height: number) => string;
	highlightNote: string;
}

const ZH: AskCopy = {
	askDom: (title, tag, suggestion) => `请调整设计稿 frame「${title}」中选中的 <${tag}> 元素：${suggestion}`,
	askFrame: (title, suggestion) => `请调整设计稿 frame「${title}」：${suggestion}`,
	askFrames: (count, suggestion) => `请调整设计稿中的 ${count} 个 frame：${suggestion}`,
	askDesign: (suggestion) => `请调整这份设计稿：${suggestion}`,
	metaHeader:
		"以下是画布提供的定位元信息（先用 Read 查看上方 @ 引用的截图，再按 vetta-ui-design skill 约定直接改源码，保存后画布会热更新）：",
	designDoc: (path) => `- 设计文档: ${path}`,
	sourcesDir: (path) => `- 源码目录: ${path}`,
	frameLine: (title, file, size, which) => `- Frame「${title}」: ${file}${size}${which}`,
	frameSize: (width, height) => `，画布当前尺寸 ${width}x${height}`,
	whichShot: (index) => `（截图 ${index}）`,
	existingFrames: (list) => `- 现有 frame: ${list}`,
	frameEntry: (id, title) => `${id}（${title}）`,
	frameSeparator: "、",
	noFrames: "- 这份设计稿还没有 frame",
	noSelection: "- 用户没有选中任何 frame，请根据诉求自行判断改哪些文件、或新建 frame",
	sourceLocation: (path) => `- 精确源码位置（编译期插桩）: ${path}`,
	noSourceLocation: "- 无插桩定位，请用下面的 class/文本在 frame 源码里检索",
	element: (tag) => `- 元素: <${tag}>`,
	domPath: (path) => `- DOM 路径: ${path}`,
	classes: (value) => `- class: ${value}`,
	text: (value) => `- 文本: ${value}`,
	renderedSize: (width, height) => `- 渲染尺寸: ${width}x${height}`,
	highlightNote: "- 截图中带边框高亮的区域就是用户选中的元素",
};

const EN: AskCopy = {
	askDom: (title, tag, suggestion) =>
		`Please adjust the selected <${tag}> element in design frame "${title}": ${suggestion}`,
	askFrame: (title, suggestion) => `Please adjust design frame "${title}": ${suggestion}`,
	askFrames: (count, suggestion) => `Please adjust ${count} frames in this design: ${suggestion}`,
	askDesign: (suggestion) => `Please adjust this design: ${suggestion}`,
	metaHeader:
		"Locating context from the canvas (first Read the screenshots referenced with @ above, then edit the sources directly following the vetta-ui-design skill — the canvas hot-reloads on save):",
	designDoc: (path) => `- Design document: ${path}`,
	sourcesDir: (path) => `- Sources dir: ${path}`,
	frameLine: (title, file, size, which) => `- Frame "${title}": ${file}${size}${which}`,
	frameSize: (width, height) => `, current canvas size ${width}x${height}`,
	whichShot: (index) => ` (screenshot ${index})`,
	existingFrames: (list) => `- Existing frames: ${list}`,
	frameEntry: (id, title) => `${id} (${title})`,
	frameSeparator: ", ",
	noFrames: "- This design has no frames yet",
	noSelection:
		"- The user selected no frame — decide from the request which files to edit, or whether to add a new frame",
	sourceLocation: (path) => `- Exact source location (compile-time instrumentation): ${path}`,
	noSourceLocation: "- No instrumented location; search the frame source using the class/text below",
	element: (tag) => `- Element: <${tag}>`,
	domPath: (path) => `- DOM path: ${path}`,
	classes: (value) => `- class: ${value}`,
	text: (value) => `- Text: ${value}`,
	renderedSize: (width, height) => `- Rendered size: ${width}x${height}`,
	highlightNote: "- The outlined region in the screenshot is the element the user selected",
};

/**
 * 按用户这句诉求自己的语言选模板，而不是宿主 UI 语言。这条 prompt 会作为一条
 * user 消息进对话，宿主界面是中文、用户却在用英文聊天时，中文外壳就是给模型的
 * 语言信号，会把整个会话翻成中文（回复、autotitle、输入预测一起中招）。
 */
function copyFor(suggestion: string): AskCopy {
	return /[㐀-䶿一-鿿豈-﫿]/u.test(suggestion) ? ZH : EN;
}

/**
 * "让 Vetta 调整" 发送给 agent 的 prompt：用户建议 + @截图引用（DOM 选中时截图内
 * 已高亮该元素）+ 定位元信息。支持三种目标：整个设计（无选中）、N 个 frame、
 * frame 内的某个元素。
 */
export function buildAskPrompt(session: DesignSession, target: AskTarget, suggestion: string): string {
	const { shots, dom } = target;
	const c = copyFor(suggestion);
	const frameOf = (frameId: string) => session.manifest.frames.find((frame) => frame.id === frameId);
	const titleOf = (frameId: string) => frameOf(frameId)?.title || frameId;
	const fileOf = (frameId: string) => `${session.dirPath}/${frameOf(frameId)?.file ?? `frames/${frameId}.tsx`}`;

	const lines: string[] = [];
	for (const shot of shots) lines.push(`@${shot.screenshotPath}`);
	if (shots.length > 0) lines.push("");

	if (dom) {
		lines.push(c.askDom(titleOf(dom.frameId), dom.payload.tag, suggestion));
	} else if (shots.length === 1) {
		lines.push(c.askFrame(titleOf(shots[0].frameId), suggestion));
	} else if (shots.length > 1) {
		lines.push(c.askFrames(shots.length, suggestion));
	} else {
		lines.push(c.askDesign(suggestion));
	}

	lines.push("", "---", c.metaHeader, c.designDoc(session.vetdPath), c.sourcesDir(session.dirPath));

	if (shots.length > 0) {
		shots.forEach((shot, index) => {
			const entry = frameOf(shot.frameId);
			const size = entry ? c.frameSize(entry.width, entry.height) : "";
			const which = shots.length > 1 ? c.whichShot(index + 1) : "";
			lines.push(c.frameLine(titleOf(shot.frameId), fileOf(shot.frameId), size, which));
		});
	} else {
		const all = session.manifest.frames;
		lines.push(
			all.length > 0
				? c.existingFrames(
						all.map((frame) => c.frameEntry(frame.id, frame.title || frame.id)).join(c.frameSeparator),
					)
				: c.noFrames,
			c.noSelection,
		);
	}

	if (dom) {
		lines.push(...domMetaLines(session, dom.payload, c));
		lines.push(c.highlightNote);
	}
	return lines.filter(Boolean).join("\n");
}

function domMetaLines(session: DesignSession, payload: SelectedElementPayload, c: AskCopy): string[] {
	return [
		payload.source ? c.sourceLocation(`${session.dirPath}/${payload.source}`) : c.noSourceLocation,
		c.element(payload.tag),
		c.domPath(payload.domPath),
		payload.classes ? c.classes(payload.classes) : "",
		payload.text ? c.text(JSON.stringify(payload.text)) : "",
		c.renderedSize(Math.round(payload.rect.width), Math.round(payload.rect.height)),
	];
}
