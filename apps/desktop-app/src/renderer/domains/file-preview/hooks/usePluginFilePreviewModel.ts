import type { FilePreviewItem } from "@vetta/theme-ui/file-preview";
import type { PluginFilePreviewContribution, PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { useMemo } from "react";

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	ico: "image/x-icon",
	svg: "image/svg+xml",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/mp4",
	aac: "audio/aac",
	opus: "audio/ogg",
	webm: "audio/webm",
	mp4: "video/mp4",
	m4v: "video/x-m4v",
	mov: "video/quicktime",
	ogv: "video/ogg",
	drawio: "application/xml",
	xml: "application/xml",
	json: "application/json",
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

function mimeForExtension(ext: string, fallback?: string): string {
	return fallback ?? MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

function base64ToText(base64: string): string {
	return new TextDecoder().decode(new Uint8Array(base64ToArrayBuffer(base64)));
}

export function usePluginFilePreviewModel(
	item: FilePreviewItem,
	ext: string,
	component: PluginFilePreviewContribution["component"],
): {
	file: PluginPreviewFile;
	component: PluginFilePreviewContribution["component"];
} {
	const file = useMemo<PluginPreviewFile>(() => {
		const readRaw = async (): Promise<{ content: string; encoding: "utf8" | "base64" }> => {
			if (item.path) return await window.vetta.fs.readFile(item.path);
			if (item.url) {
				const res = await fetch(item.url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const buf = await res.arrayBuffer();
				let binary = "";
				const bytes = new Uint8Array(buf);
				const chunk = 0x8000;
				for (let i = 0; i < bytes.length; i += chunk) {
					binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
				}
				return { content: btoa(binary), encoding: "base64" };
			}
			throw new Error("无可用数据源");
		};

		return {
			path: item.path ?? null,
			name: item.name,
			extension: ext,
			mime: mimeForExtension(ext, item.mime),
			size: item.size ?? 0,
			readText: async () => {
				const { content, encoding } = await readRaw();
				return encoding === "utf8" ? content : base64ToText(content);
			},
			readBytes: async () => {
				const { content, encoding } = await readRaw();
				if (encoding === "base64") return base64ToArrayBuffer(content);
				return new TextEncoder().encode(content).buffer;
			},
			getUrl: (options) => {
				if (item.url) return item.url;
				if (!item.path) return "";
				const params = new URLSearchParams({ path: item.path });
				if (options?.mediaKind) params.set("kind", options.mediaKind);
				return `vetta-media://local/stream?${params.toString()}`;
			},
			watch: (listener) => {
				const path = item.path;
				if (!path) return { dispose() {} };
				const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
				const dir = slash > 0 ? path.slice(0, slash) : path;
				void window.vetta.fs.watchDir(dir);
				const unsub = window.vetta.fs.onDirChanged((changed) => {
					if (changed === dir) listener();
				});
				return {
					dispose() {
						unsub();
						void window.vetta.fs.unwatchDir(dir);
					},
				};
			},
			getAudioMetadata: async () => {
				if (!item.path) return null;
				return await window.vetta.media.getAudioMetadata(item.path);
			},
		};
	}, [item, ext]);

	return { file, component };
}
