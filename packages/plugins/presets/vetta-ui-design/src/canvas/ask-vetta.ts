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
 * "让 Vetta 调整" 发送给 agent 的 prompt（LLM 协议串，保持中文原样即可）：
 * 用户建议 + @截图引用（DOM 选中时截图内已高亮该元素）+ 定位元信息。
 * 支持三种目标：整个设计（无选中）、N 个 frame、frame 内的某个元素。
 */
export function buildAskPrompt(session: DesignSession, target: AskTarget, suggestion: string): string {
	const { shots, dom } = target;
	const frameOf = (frameId: string) => session.manifest.frames.find((frame) => frame.id === frameId);
	const titleOf = (frameId: string) => frameOf(frameId)?.title || frameId;
	const fileOf = (frameId: string) => `${session.dirPath}/${frameOf(frameId)?.file ?? `frames/${frameId}.tsx`}`;

	const lines: string[] = [];
	for (const shot of shots) lines.push(`@${shot.screenshotPath}`);
	if (shots.length > 0) lines.push("");

	if (dom) {
		lines.push(`请调整设计稿 frame「${titleOf(dom.frameId)}」中选中的 <${dom.payload.tag}> 元素：${suggestion}`);
	} else if (shots.length === 1) {
		lines.push(`请调整设计稿 frame「${titleOf(shots[0].frameId)}」：${suggestion}`);
	} else if (shots.length > 1) {
		lines.push(`请调整设计稿中的 ${shots.length} 个 frame：${suggestion}`);
	} else {
		lines.push(`请调整这份设计稿：${suggestion}`);
	}

	lines.push(
		"",
		"---",
		"以下是画布提供的定位元信息（先用 Read 查看上方 @ 引用的截图，再按 vetta-ui-design skill 约定直接改源码，保存后画布会热更新）：",
		`- 设计文档: ${session.vetdPath}`,
		`- 源码目录: ${session.dirPath}`,
	);

	if (shots.length > 0) {
		shots.forEach((shot, index) => {
			const entry = frameOf(shot.frameId);
			const size = entry ? `，画布当前尺寸 ${entry.width}x${entry.height}` : "";
			const which = shots.length > 1 ? `（截图 ${index + 1}）` : "";
			lines.push(`- Frame「${titleOf(shot.frameId)}」: ${fileOf(shot.frameId)}${size}${which}`);
		});
	} else {
		const all = session.manifest.frames;
		lines.push(
			all.length > 0
				? `- 现有 frame: ${all.map((frame) => `${frame.id}（${frame.title || frame.id}）`).join("、")}`
				: "- 这份设计稿还没有 frame",
			"- 用户没有选中任何 frame，请根据诉求自行判断改哪些文件、或新建 frame",
		);
	}

	if (dom) {
		lines.push(...domMetaLines(session, dom.payload));
		lines.push("- 截图中带边框高亮的区域就是用户选中的元素");
	}
	return lines.filter(Boolean).join("\n");
}

function domMetaLines(session: DesignSession, payload: SelectedElementPayload): string[] {
	return [
		payload.source
			? `- 精确源码位置（编译期插桩）: ${session.dirPath}/${payload.source}`
			: "- 无插桩定位，请用下面的 class/文本在 frame 源码里检索",
		`- 元素: <${payload.tag}>`,
		`- DOM 路径: ${payload.domPath}`,
		payload.classes ? `- class: ${payload.classes}` : "",
		payload.text ? `- 文本: ${JSON.stringify(payload.text)}` : "",
		`- 渲染尺寸: ${Math.round(payload.rect.width)}x${Math.round(payload.rect.height)}`,
	];
}
