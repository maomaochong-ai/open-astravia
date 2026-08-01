import type { DesignSession } from "../vetd/design-session";
import type { SelectedElementPayload } from "./bridge-client";
import type { CanvasSelection } from "./DesignCanvas";

/**
 * "让 Vetta 调整" 发送给 agent 的 prompt（LLM 协议串，保持中文原样即可）：
 * 用户建议 + @截图引用（DOM 选中时截图内已高亮该元素）+ 定位元信息。
 */
export function buildAskPrompt(
	session: DesignSession,
	selection: NonNullable<CanvasSelection>,
	screenshotPath: string,
	suggestion: string,
): string {
	const frameId = selection.kind === "frame" ? selection.id : selection.frameId;
	const entry = session.manifest.frames.find((frame) => frame.id === frameId);
	const frameFile = `${session.dirPath}/${entry?.file ?? `frames/${frameId}.tsx`}`;

	const lines: string[] = [
		`@${screenshotPath}`,
		"",
		selection.kind === "frame"
			? `请调整设计稿 frame「${entry?.title || frameId}」：${suggestion}`
			: `请调整设计稿 frame「${entry?.title || frameId}」中选中的 <${selection.payload.tag}> 元素：${suggestion}`,
		"",
		"---",
		"以下是画布提供的定位元信息（先用 Read 查看上方 @ 引用的截图，再按 vetta-ui-design skill 约定直接改源码，保存后画布会热更新）：",
		`- 设计文档: ${session.vetdPath}`,
		`- 源码目录: ${session.dirPath}`,
		`- Frame 源码: ${frameFile}`,
		entry ? `- 画布当前尺寸: ${entry.width}x${entry.height}` : "",
	];
	if (selection.kind === "dom") {
		lines.push(...domMetaLines(session, selection.payload));
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
