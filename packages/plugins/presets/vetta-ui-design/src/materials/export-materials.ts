/**
 * 下载素材：把若干 frame 的完整内容图落成文件。
 *
 * 与「导出渲染图」的区别：那边是排版过的展示图（设备外壳、背景、品牌标），这边是
 * 原始素材——每帧一张原尺寸完整图（含视口外的滚动内容），交给设计师二次加工。
 *
 * 一张图直接另存为 png；多张打成一个 zip（逐张弹另存为对话框没法用）；PDF 一帧
 * 一页、页面尺寸就是内容的 CSS 尺寸（1px = 1pt），手机帧和桌面帧在同一份 PDF 里
 * 保持真实比例。截图函数由调用方注入：这里只管顺序、命名、打包与落盘。
 */
import { zipSync, type Zippable } from "fflate";
import { bytesToBase64, dataUrlToBytes } from "../mockup/binary";
import { buildImagePdf, type PdfPageImage } from "../mockup/pdf";
import type { FullFrameImage, MaterialFormat } from "./capture-full-frame";

export type MaterialKind = "images" | "pdf";

export interface MaterialFrame {
	id: string;
	title: string;
}

export interface MaterialSaveOptions {
	title: string;
	filters: Array<{ name: string; extensions: string[] }>;
}

export interface ExportMaterialsRequest {
	/** 设计文档名：文件名的前缀。 */
	designName: string;
	/** 导出顺序即画布顺序，由调用方排好。 */
	frames: readonly MaterialFrame[];
	kind: MaterialKind;
	capture(frame: MaterialFrame, format: MaterialFormat): Promise<FullFrameImage>;
	/** 宿主的另存为对话框；用户取消时返回 null。 */
	saveAs(fileName: string, base64: string, options: MaterialSaveOptions): Promise<string | null>;
	/** 每截完一帧回报一次；用来在按钮上显示「2/5」。 */
	onProgress?(done: number, total: number): void;
	/** 对话框标题的文案由调用方按当前语言给。 */
	saveTitle: string;
}

/**
 * 文件名里的标题：去掉各系统都不接受的字符，空了就退回 frame id。
 * 序号在前，zip 解开来的顺序才与画布一致。
 */
export function materialFileName(index: number, frame: MaterialFrame, extension: string): string {
	const cleaned = frame.title
		// biome-ignore lint/suspicious/noControlCharactersInRegex: 控制字符在文件名里同样非法
		.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[-. ]+|[-. ]+$/g, "");
	const stem = cleaned.length > 0 ? cleaned : frame.id;
	return `${String(index + 1).padStart(2, "0")}-${stem}.${extension}`;
}

/** 返回保存到的路径；用户在对话框里取消返回 null。 */
export async function exportMaterials(request: ExportMaterialsRequest): Promise<string | null> {
	const { frames, kind } = request;
	if (frames.length === 0) return null;
	const total = frames.length;
	// PDF 页面用 jpeg：DCTDecode 原样内嵌，一页几百 KB；png 会让一份十页的 PDF 上百 MB。
	const format: MaterialFormat = kind === "pdf" ? "jpeg" : "png";
	const shots: FullFrameImage[] = [];
	for (const frame of frames) {
		shots.push(await request.capture(frame, format));
		request.onProgress?.(shots.length, total);
	}

	if (kind === "pdf") {
		const pages: PdfPageImage[] = shots.map((shot) => ({
			jpeg: dataUrlToBytes(shot.dataUrl),
			width: shot.pixelWidth,
			height: shot.pixelHeight,
			pageWidth: shot.cssWidth,
		}));
		const pdf = buildImagePdf(pages, Math.max(...pages.map((page) => page.pageWidth ?? 0)));
		return request.saveAs(`${request.designName}-frames.pdf`, bytesToBase64(pdf), {
			title: request.saveTitle,
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
	}

	if (shots.length === 1 && frames[0]) {
		const only = shots[0];
		if (!only) return null;
		return request.saveAs(materialFileName(0, frames[0], "png"), only.dataUrl.split(",")[1] ?? "", {
			title: request.saveTitle,
			filters: [{ name: "PNG", extensions: ["png"] }],
		});
	}

	// png 自身已压缩，zip 只做归档（level 0），省掉一次徒劳的 deflate。
	const entries: Zippable = {};
	frames.forEach((frame, index) => {
		const shot = shots[index];
		if (shot) entries[materialFileName(index, frame, "png")] = [dataUrlToBytes(shot.dataUrl), { level: 0 }];
	});
	const zip = zipSync(entries);
	return request.saveAs(`${request.designName}-frames.zip`, bytesToBase64(zip), {
		title: request.saveTitle,
		filters: [{ name: "ZIP", extensions: ["zip"] }],
	});
}
