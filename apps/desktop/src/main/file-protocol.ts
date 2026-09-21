import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { isSshProjectUri } from "@vetta/ssh-transport";
import { type CustomScheme, protocol } from "electron";
import { FILE_PROTOCOL_SCHEME } from "../shared/file-protocol.js";
import { openRemoteMediaSource } from "./filesystem/remote-filesystem.js";
import { assertPathReadableForPreview } from "./ipc/fs.js";

/**
 * 静态文件协议（ADR-0027）：把校验过的本地文件路径映射为可直接作 iframe/img/script
 * src 的 URL。与媒体流协议（vetta-media://，query 参数承载路径）刻意不同：本协议
 * **pathname 直接承载绝对路径**——HTML 内相对引用的 css/js/图片按所在目录天然解析
 * 正确，无需改写 HTML。凡需「整页带资源地预览项目内 HTML」走本协议。
 *
 * URL 形态：vetta-file://local/<绝对路径>
 */

const FILE_MIME: Record<string, string> = {
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	md: "text/plain; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	webmanifest: "application/manifest+json",
	wasm: "application/wasm",
	mp4: "video/mp4",
	webm: "video/webm",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
};

/** 特权声明须在 app ready 之前随其他自定义 scheme 由 main.ts 合并注册。 */
export const FILE_PROTOCOL_PRIVILEGE: CustomScheme = {
	scheme: FILE_PROTOCOL_SCHEME,
	privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
};

/** 协议处理的主体，与 Electron 的注册解耦以便测试。 */
export async function handleFileRequest(request: Request): Promise<Response> {
	{
		let filePath: string;
		try {
			const url = new URL(request.url);
			filePath = decodeURIComponent(url.pathname);
			// Windows 形态 "/C:/..." → "C:/..."
			if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
			// 远程项目形态 "/ssh://host/..." → "ssh://host/..."：路径被放进 URL 的 pathname，
			// 总会多一个前导斜杠，留着它就不再是一个可识别的远程路径了。
			if (filePath.startsWith("/ssh://")) filePath = filePath.slice(1);
			// 与 fs IPC 预览读取同一道沙箱边界：防止渲染进程借本协议任意读取磁盘文件
			assertPathReadableForPreview(filePath);
		} catch {
			return new Response("Forbidden", { status: 403 });
		}

		const ext = extname(filePath).slice(1).toLowerCase();
		// 远程项目里的文件由 SSH 取回。`vetta-media://` 早就支持远端，这里若不支持，同一个
		// 插件用前者能播、用后者只得到一张破图，而且没有任何提示。
		if (isSshProjectUri(filePath)) {
			const remote = await openRemoteMediaSource(filePath).catch(() => null);
			if (!remote) return new Response("Not found", { status: 404 });
			return new Response(remote.size === 0 ? null : remote.stream(0, remote.size - 1), {
				status: 200,
				headers: {
					"Content-Type": FILE_MIME[ext] ?? "application/octet-stream",
					"Content-Length": String(remote.size),
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		let size: number;
		try {
			const stats = await stat(filePath);
			if (!stats.isFile()) return new Response("Not a file", { status: 404 });
			size = stats.size;
		} catch {
			return new Response("Not found", { status: 404 });
		}

		const stream = createReadStream(filePath);
		return new Response(Readable.toWeb(stream) as ReadableStream, {
			status: 200,
			headers: {
				"Content-Type": FILE_MIME[ext] ?? "application/octet-stream",
				"Content-Length": String(size),
				"Access-Control-Allow-Origin": "*",
			},
		});
	}
}

export function registerFileProtocolHandler(): void {
	protocol.handle(FILE_PROTOCOL_SCHEME, handleFileRequest);
}
