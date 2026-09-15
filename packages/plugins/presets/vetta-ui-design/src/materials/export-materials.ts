/**
 * 下载素材：把若干 frame 的完整内容图落成文件。
 *
 * 与「导出渲染图」的区别：那边是排版过的展示图（设备外壳、背景、品牌标），这边是
 * 原始素材——每帧一张原尺寸完整图（含视口外的滚动内容），交给设计师二次加工。
 *
 * 分两步：{@link renderMaterials} 逐帧截图并产出文件内容（PDF 一帧一页、页面尺寸
 * 就是内容的 CSS 尺寸，1px = 1pt，手机帧和桌面帧在同一份 PDF 里保持真实比例）；
 * 怎么落盘由入口决定——画布弹另存为对话框（{@link saveMaterialsAs}），agent 工具
 * 直接写进工作区。截图函数由调用方注入：这里只管顺序、命名与打包。
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

export interface MaterialFile {
	frameId: string;
	fileName: string;
	bytes: Uint8Array;
}

export type MaterialBundle =
	| { kind: "pdf"; fileName: string; bytes: Uint8Array; frameIds: string[] }
	| { kind: "images"; files: MaterialFile[] };

export interface RenderMaterialsRequest {
	/** 设计文档名：文件名的前缀。 */
	designName: string;
	/** 导出顺序，由调用方排好。 */
	frames: readonly MaterialFrame[];
	kind: MaterialKind;
	capture(frame: MaterialFrame, format: MaterialFormat): Promise<FullFrameImage>;
	/** 每截完一帧回报一次；用来在按钮上显示「2/5」。 */
	onProgress?(done: number, total: number): void;
}

export type MaterialSaveAs = (fileName: string, base64: string, options: MaterialSaveOptions) => Promise<string | null>;

export interface ExportMaterialsRequest extends RenderMaterialsRequest {
	/** 宿主的另存为对话框；用户取消时返回 null。 */
	saveAs: MaterialSaveAs;
	/** 对话框标题的文案由调用方按当前语言给。 */
	saveTitle: string;
}

const RESERVED_FILE_CHARS = '\\/:*?"<>|';

/**
 * 文件名里的标题：去掉各系统都不接受的字符，空了就退回 frame id。
 * 序号在前，解开来的顺序才与导出顺序一致。
 */
export function materialFileName(index: number, frame: MaterialFrame, extension: string): string {
	// 控制字符（码位 < 32）与 Windows 保留字符在文件名里都非法；连着的一串换成一个连字符。
	let replaced = "";
	let inRun = false;
	for (const char of frame.title) {
		const illegal = char.charCodeAt(0) < 32 || RESERVED_FILE_CHARS.includes(char);
		if (illegal && !inRun) replaced += "-";
		else if (!illegal) replaced += char;
		inRun = illegal;
	}
	const cleaned = replaced
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[-. ]+|[-. ]+$/g, "");
	const stem = cleaned.length > 0 ? cleaned : frame.id;
	return `${String(index + 1).padStart(2, "0")}-${stem}.${extension}`;
}

/** 逐帧截图并产出文件内容；空范围返回 null。 */
export async function renderMaterials(request: RenderMaterialsRequest): Promise<MaterialBundle | null> {
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
		return {
			kind: "pdf",
			fileName: `${request.designName}-frames.pdf`,
			bytes: buildImagePdf(pages, Math.max(...pages.map((page) => page.pageWidth ?? 0))),
			frameIds: frames.map((frame) => frame.id),
		};
	}

	return {
		kind: "images",
		files: frames.map((frame, index) => ({
			frameId: frame.id,
			fileName: materialFileName(index, frame, "png"),
			bytes: dataUrlToBytes(shots[index]?.dataUrl ?? ""),
		})),
	};
}

/**
 * 画布的落盘方式：一张图直接另存为 png；多张打成一个 zip（逐张弹另存为对话框没法用）。
 * 返回保存到的路径；用户在对话框里取消返回 null。
 */
export async function saveMaterialsAs(
	bundle: MaterialBundle,
	designName: string,
	saveAs: MaterialSaveAs,
	title: string,
): Promise<string | null> {
	if (bundle.kind === "pdf") {
		return saveAs(bundle.fileName, bytesToBase64(bundle.bytes), {
			title,
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
	}
	const [only] = bundle.files;
	if (bundle.files.length === 1 && only) {
		return saveAs(only.fileName, bytesToBase64(only.bytes), {
			title,
			filters: [{ name: "PNG", extensions: ["png"] }],
		});
	}
	// png 自身已压缩，zip 只做归档（level 0），省掉一次徒劳的 deflate。
	const entries: Zippable = {};
	for (const file of bundle.files) entries[file.fileName] = [file.bytes, { level: 0 }];
	return saveAs(`${designName}-frames.zip`, bytesToBase64(zipSync(entries)), {
		title,
		filters: [{ name: "ZIP", extensions: ["zip"] }],
	});
}

/** 画布「下载素材」：截图 + 另存为。返回保存到的路径；取消或空范围返回 null。 */
export async function exportMaterials(request: ExportMaterialsRequest): Promise<string | null> {
	const bundle = await renderMaterials(request);
	if (!bundle) return null;
	return saveMaterialsAs(bundle, request.designName, request.saveAs, request.saveTitle);
}
