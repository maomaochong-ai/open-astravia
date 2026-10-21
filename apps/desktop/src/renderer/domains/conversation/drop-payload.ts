/**
 * 输入框拖拽落点共用的判定逻辑。
 *
 * Windows 上文件树用 Electron 原生 startDrag（CF_HDROP）起拖，拖回同一窗口时
 * Chromium 不一定把类型报成 "Files"，可能只剩 text/plain 甚至空 types。早期只认
 * "Files" 时判定失败就不 preventDefault，drop 随即落到编辑器里被当成纯文本，用户
 * 看到的就是「拖一堆文件只插进来一串路径」。
 */

export type DropDragKind = "files" | "internal";

export const ASTRAVIA_PATH_MIME = "application/astravia-path";

export interface DropTypeSnapshot {
	/** `DataTransfer.types`：dragenter/dragover 阶段拿不到文件内容，只能看类型。 */
	readonly types: readonly string[];
	/** 是否处于 drop 阶段：这时 files 与 dataTransfer 内的数据才可读。 */
	readonly dropPhase: boolean;
	/** `DataTransfer.files.length`。 */
	readonly fileCount: number;
}

export function readDropSnapshot(event: {
	readonly type: string;
	readonly dataTransfer: DataTransfer | null;
}): DropTypeSnapshot {
	const transfer = event.dataTransfer;
	return {
		types: transfer ? Array.from(transfer.types) : [],
		dropPhase: event.type === "drop",
		fileCount: transfer?.files.length ?? 0,
	};
}

export function detectDropKind(snapshot: DropTypeSnapshot): DropDragKind | null {
	if (snapshot.types.includes(ASTRAVIA_PATH_MIME)) return "internal";
	if (snapshot.types.includes("Files")) return "files";
	// drop 阶段才有真实文件列表；URI 列表也算文件拖拽，Windows 上常常只有它。
	if (snapshot.dropPhase && (snapshot.fileCount > 0 || snapshot.types.includes("text/uri-list"))) return "files";
	// 普通文本拖拽一定带 text/plain；空 types 只可能来自原生拖拽，按文件放行，
	// drop 阶段解析不到路径时自然什么都不做。
	if (snapshot.types.length === 0) return "files";
	return null;
}

/** Windows 原生拖拽偶尔只暴露 URI 列表而不是 File 对象，从里面还原本地路径。 */
export function parseFileUriList(raw: string): string[] {
	if (!raw) return [];
	const paths: string[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith("file:")) continue;
		try {
			const decoded = decodeURIComponent(new URL(trimmed).pathname);
			// Windows 的 file URL 是 file:///C:/dir/a.txt，pathname 多一个前导斜杠。
			paths.push(/^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded);
		} catch {
			// 非法 URI 直接跳过
		}
	}
	return paths;
}
