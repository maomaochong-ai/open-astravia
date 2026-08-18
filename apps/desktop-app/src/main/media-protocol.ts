import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { getVettaHomePath } from "@vetta/action-rpc";
import { type CustomScheme, protocol } from "electron";
import { assertPathReadableForPreview } from "./ipc/fs.js";

/**
 * 媒体流协议（ADR-0021）：把校验过的本地媒体路径映射为支持 Range 的流式 URL，
 * 供 <audio>（未来含 <video>）直接作 src。与既有 readFile IPC + base64 全量
 * 加载并存——无损音频可达百 MB，全量 IPC 会阻塞且内存翻倍，故走流式。
 *
 * URL 形态：vetta-media://local/stream?path=<encodeURIComponent(绝对路径)>
 * 路径走 query 参数而非 pathname，避免 Chromium 对 standard scheme 的
 * 路径规范化改写编码后的分隔符。
 */
export const MEDIA_PROTOCOL_SCHEME = "vetta-media";

const MEDIA_MIME: Record<string, string> = {
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	opus: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/mp4",
	aac: "audio/aac",
	webm: "audio/webm",
	mp4: "video/mp4",
	m4v: "video/x-m4v",
	mov: "video/quicktime",
	ogv: "video/ogg",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	ico: "image/x-icon",
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
	xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const PLUGIN_DATA_ROOT = resolve(join(getVettaHomePath(), "plugin-data"));

function isPluginDataPath(path: string): boolean {
	const relation = relative(PLUGIN_DATA_ROOT, resolve(path));
	return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

/**
 * 特权声明须在 app ready 之前随其他自定义 scheme 由 main.ts 合并注册
 * （registerSchemesAsPrivileged 只能调用一次）。stream 标记是媒体播放的关键；
 * corsEnabled + 响应上的 ACAO 头让 Web Audio AnalyserNode（频谱可视化）
 * 能读到真实采样而非零数据。
 */
export const MEDIA_PROTOCOL_PRIVILEGE: CustomScheme = {
	scheme: MEDIA_PROTOCOL_SCHEME,
	privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
};

/** 解析 "bytes=start-end" / "bytes=start-"。多段 Range 不支持，返回 null 走整文件。 */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;
	const [, startStr, endStr] = match;
	if (startStr === "" && endStr === "") return null;
	if (startStr === "") {
		// 后缀范围：最后 N 字节
		const suffix = Number(endStr);
		if (suffix <= 0) return null;
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(startStr);
	const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
	if (start > end || start >= size) return null;
	return { start, end };
}

export function registerMediaProtocolHandler(): void {
	protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
		let filePath: string;
		let mediaKind: string | null = null;
		let declaredMimeType: string | null = null;
		try {
			const url = new URL(request.url);
			const rawPath = url.searchParams.get("path");
			if (!rawPath) return new Response("Missing path", { status: 400 });
			mediaKind = url.searchParams.get("kind");
			filePath = resolve(rawPath);
			const requestedMimeType = url.searchParams.get("mime");
			if (requestedMimeType && isPluginDataPath(filePath) && MIME_TYPE_PATTERN.test(requestedMimeType)) {
				declaredMimeType = requestedMimeType;
			}
			// 与 fs IPC 预览读取同一道沙箱边界：防止渲染进程借本协议任意读取磁盘文件
			assertPathReadableForPreview(filePath);
		} catch {
			return new Response("Forbidden", { status: 403 });
		}

		let size: number;
		try {
			const stats = await stat(filePath);
			if (!stats.isFile()) return new Response("Not a file", { status: 404 });
			size = stats.size;
		} catch {
			return new Response("Not found", { status: 404 });
		}

		const ext = extname(filePath).slice(1).toLowerCase();
		const contentType =
			declaredMimeType ??
			(ext === "webm" && mediaKind === "video" ? "video/webm" : (MEDIA_MIME[ext] ?? "application/octet-stream"));
		const baseHeaders: Record<string, string> = {
			"Content-Type": contentType,
			"Accept-Ranges": "bytes",
			"Access-Control-Allow-Origin": "*",
		};

		const range = parseRange(request.headers.get("Range"), size);
		if (range) {
			const stream = createReadStream(filePath, { start: range.start, end: range.end });
			return new Response(Readable.toWeb(stream) as ReadableStream, {
				status: 206,
				headers: {
					...baseHeaders,
					"Content-Length": String(range.end - range.start + 1),
					"Content-Range": `bytes ${range.start}-${range.end}/${size}`,
				},
			});
		}

		const stream = createReadStream(filePath);
		return new Response(Readable.toWeb(stream) as ReadableStream, {
			status: 200,
			headers: { ...baseHeaders, "Content-Length": String(size) },
		});
	});
}
