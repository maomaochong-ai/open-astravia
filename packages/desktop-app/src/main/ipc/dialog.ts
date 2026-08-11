import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { dialog, ipcMain } from "electron";
import { getAppLogger } from "../logger.js";
import { allowProjectRoot, assertPathReadableForPreview } from "./fs.js";
import { selectFoldersWithLinuxPortal } from "./linux-portal-dialog.js";

const log = getAppLogger("dialog");

const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
};

const EXT_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
};

/** 用户附加图片的临时缓存根目录：~/.vetta/image-cache/<sessionId>/ */
function imageCacheDir(): string {
	return join(getVettaHomePath(), "image-cache");
}

/** 文件名/目录名安全化：runtimeId 通常是 uuid，但仍兜底剔除非法字符。 */
function sanitizeSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 启动时清理超过 7 天未变动的旧会话图片缓存目录（目录内写入新文件会刷新其 mtime，
 * 故活跃会话不会被误删）。 */
const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
async function cleanupOldImageCaches(): Promise<void> {
	const root = imageCacheDir();
	let names: string[];
	try {
		names = await readdir(root);
	} catch {
		// 根目录尚不存在——无需清理。
		return;
	}
	const now = Date.now();
	await Promise.all(
		names.map(async (name) => {
			const dir = join(root, name);
			try {
				const st = await stat(dir);
				if (st.isDirectory() && now - st.mtimeMs > IMAGE_CACHE_TTL_MS) {
					await rm(dir, { recursive: true, force: true });
				}
			} catch {
				// 单个目录清理失败不影响其余。
			}
		}),
	);
}

export function registerDialogIpc(): () => void {
	// 启动期顺手清理过期图片缓存（fire-and-forget，不阻塞 IPC 注册）。
	void cleanupOldImageCaches();

	// 把用户附加的图片（base64）落盘到按会话分目录的缓存，返回绝对路径。
	// 调用方据此用 @路径 引用图片，交由 agent 的 Read 工具按需读取，
	// 从而不再把 base64 直接塞进上下文（不支持视觉的模型也能用工具处理图片）。
	ipcMain.handle(
		"vetta:dialog:persist-images",
		async (_event, sessionId: string, images: Array<{ id: string; data: string; mimeType: string }>) => {
			if (!sessionId || !Array.isArray(images) || images.length === 0) return [];
			const dir = join(imageCacheDir(), sanitizeSegment(sessionId));
			await mkdir(dir, { recursive: true });
			const paths: string[] = [];
			for (const img of images) {
				if (!img?.data) continue;
				const ext = EXT_BY_MIME[img.mimeType] || "png";
				const fileName = `${sanitizeSegment(img.id) || "img"}.${ext}`;
				const filePath = join(dir, fileName);
				await writeFile(filePath, Buffer.from(img.data, "base64"));
				paths.push(filePath);
			}
			return paths;
		},
	);

	ipcMain.handle("vetta:dialog:select-images", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile", "multiSelections"],
			title: "Select Images",
			filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
		});
		if (result.canceled || result.filePaths.length === 0) return [];
		const images = await Promise.all(
			result.filePaths.map(async (filePath) => {
				const buffer = await readFile(filePath);
				const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
				return {
					data: buffer.toString("base64"),
					mimeType: IMAGE_MIME[ext] || "image/png",
					name: basename(filePath),
				};
			}),
		);
		return images;
	});

	ipcMain.handle("vetta:dialog:select-folder", async () => {
		const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Select Project Folder" });
		if (result.canceled || result.filePaths.length === 0) return null;
		const selectedPath = result.filePaths[0];
		allowProjectRoot(selectedPath);
		return selectedPath;
	});

	ipcMain.handle("vetta:dialog:select-files", async (_event, defaultPath?: string) => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile", "multiSelections"],
			title: "选择文件",
			defaultPath: defaultPath || undefined,
		});
		if (result.canceled || result.filePaths.length === 0) return [];
		return result.filePaths;
	});

	/**
	 * 选文件并**连内容一起**返回。
	 *
	 * 为什么不复用 select-files 的「只回路径」：插件的 fs 被限制在已授权的项目根内
	 * （filesystem-service 的 allowedRoots），用户从下载目录挑一个文件，插件拿到路径也
	 * 读不了。让主进程当场读完回传，既不用把那个目录永久加进授权根（select-folder 就是
	 * 那么做的，代价是整棵目录树从此可读），也不必发明按路径的一次性授权。
	 */
	ipcMain.handle("vetta:dialog:open-file-contents", async (_event, options: unknown) => {
		const input = (options ?? {}) as {
			title?: unknown;
			filters?: unknown;
			multiple?: unknown;
			maxBytes?: unknown;
		};
		const filters = Array.isArray(input.filters)
			? input.filters.flatMap((filter) => {
					const candidate = filter as { name?: unknown; extensions?: unknown };
					if (typeof candidate?.name !== "string" || !Array.isArray(candidate.extensions)) return [];
					const extensions = candidate.extensions.filter((ext): ext is string => typeof ext === "string");
					return extensions.length > 0 ? [{ name: candidate.name, extensions }] : [];
				})
			: [];
		const properties: Array<"openFile" | "multiSelections"> =
			input.multiple === true ? ["openFile", "multiSelections"] : ["openFile"];
		const result = await dialog.showOpenDialog({
			properties,
			title: typeof input.title === "string" && input.title.trim() ? input.title : "选择文件",
			...(filters.length > 0 ? { filters } : {}),
		});
		if (result.canceled || result.filePaths.length === 0) return [];
		// 上限兜底：内容要经 IPC 以 base64 回传，一个被误选的大文件足以撑爆渲染进程。
		const maxBytes = typeof input.maxBytes === "number" && input.maxBytes > 0 ? input.maxBytes : 64 * 1024 * 1024;
		const files = [];
		for (const filePath of result.filePaths) {
			const info = await stat(filePath);
			if (info.size > maxBytes) {
				throw new Error(`File is too large to open: ${basename(filePath)} (${info.size} bytes)`);
			}
			const buffer = await readFile(filePath);
			files.push({ path: filePath, name: basename(filePath), data: buffer.toString("base64") });
		}
		return files;
	});

	ipcMain.handle("vetta:dialog:save-html", async (_event, defaultFileName: unknown, content: unknown) => {
		if (typeof defaultFileName !== "string" || !defaultFileName.trim()) {
			throw new Error("Invalid HTML export file name");
		}
		if (typeof content !== "string") {
			throw new Error("Invalid HTML export content");
		}
		const result = await dialog.showSaveDialog({
			title: "导出会话 HTML",
			defaultPath: defaultFileName,
			filters: [{ name: "HTML", extensions: ["html"] }],
		});
		if (result.canceled || !result.filePath) return null;
		await writeFile(result.filePath, content, "utf8");
		return result.filePath;
	});

	/**
	 * Write in-memory bytes to a path chosen via the native save dialog. The
	 * complement to save-copy, which needs the payload to already exist on disk.
	 * Returns the saved path, or null if cancelled.
	 */
	ipcMain.handle(
		"vetta:dialog:save-data",
		async (
			_event,
			defaultFileName: unknown,
			content: unknown,
			encoding?: unknown,
			options?: {
				title?: string;
				filters?: Array<{ name: string; extensions: string[] }>;
			},
		): Promise<string | null> => {
			if (typeof defaultFileName !== "string" || !defaultFileName.trim()) {
				throw new Error("Invalid save file name");
			}
			if (typeof content !== "string") {
				throw new Error("Invalid save content");
			}
			if (encoding !== undefined && encoding !== "utf8" && encoding !== "base64") {
				throw new Error(`Invalid save encoding: ${String(encoding)}`);
			}
			const name = basename(defaultFileName.trim());
			const ext = extname(name).replace(/^\./, "").toLowerCase();
			const filters =
				Array.isArray(options?.filters) && options.filters.length > 0
					? options.filters.filter(
							(filter) =>
								typeof filter?.name === "string" &&
								Array.isArray(filter.extensions) &&
								filter.extensions.every((entry) => typeof entry === "string"),
						)
					: ext
						? [{ name: ext.toUpperCase(), extensions: [ext] }]
						: undefined;

			const result = await dialog.showSaveDialog({
				title: typeof options?.title === "string" && options.title.trim() ? options.title.trim() : "Save File",
				defaultPath: name,
				filters,
			});
			if (result.canceled || !result.filePath) return null;
			await writeFile(result.filePath, content, encoding === "base64" ? "base64" : "utf8");
			return result.filePath;
		},
	);

	/**
	 * Copy an existing file to a path chosen via the native save dialog.
	 * Source must be readable under host preview rules (project roots or home).
	 * Destination is user-chosen (no project-root write restriction).
	 * Returns the saved path, or null if cancelled.
	 */
	ipcMain.handle(
		"vetta:dialog:save-copy",
		async (
			_event,
			sourcePath: unknown,
			options?: {
				defaultFileName?: string;
				title?: string;
				filters?: Array<{ name: string; extensions: string[] }>;
			},
		): Promise<string | null> => {
			if (typeof sourcePath !== "string" || !sourcePath.trim()) {
				throw new Error("Invalid source path");
			}
			assertPathReadableForPreview(sourcePath);
			let sourceStat: Awaited<ReturnType<typeof stat>>;
			try {
				sourceStat = await stat(sourcePath);
			} catch {
				throw new Error(`Source file not found: ${sourcePath}`);
			}
			if (!sourceStat.isFile()) {
				throw new Error(`Source is not a file: ${sourcePath}`);
			}

			const defaultFileName =
				typeof options?.defaultFileName === "string" && options.defaultFileName.trim()
					? options.defaultFileName.trim()
					: basename(sourcePath);
			const title = typeof options?.title === "string" && options.title.trim() ? options.title.trim() : "Save File";
			const filters =
				Array.isArray(options?.filters) && options.filters.length > 0
					? options.filters.filter(
							(f) =>
								typeof f?.name === "string" &&
								Array.isArray(f.extensions) &&
								f.extensions.every((e) => typeof e === "string"),
						)
					: undefined;
			const ext = extname(defaultFileName).replace(/^\./, "").toLowerCase();
			const resolvedFilters =
				filters && filters.length > 0
					? filters
					: ext
						? [{ name: ext.toUpperCase(), extensions: [ext] }]
						: undefined;

			const result = await dialog.showSaveDialog({
				title,
				defaultPath: defaultFileName,
				filters: resolvedFilters,
			});
			if (result.canceled || !result.filePath) return null;
			await copyFile(sourcePath, result.filePath);
			return result.filePath;
		},
	);

	ipcMain.handle("vetta:dialog:select-folders", async () => {
		if (process.platform === "linux") {
			try {
				const selected = await selectFoldersWithLinuxPortal();
				for (const p of selected) {
					allowProjectRoot(p);
				}
				return selected;
			} catch (error) {
				log.warn("Linux portal folder picker failed, falling back to Electron dialog:", error);
			}
		}

		const result = await dialog.showOpenDialog({
			properties: ["openDirectory", "multiSelections"],
			title: "Select Folders",
		});
		if (result.canceled || result.filePaths.length === 0) return [];
		for (const p of result.filePaths) {
			allowProjectRoot(p);
		}
		return result.filePaths;
	});

	return () => {
		ipcMain.removeHandler("vetta:dialog:persist-images");
		ipcMain.removeHandler("vetta:dialog:select-images");
		ipcMain.removeHandler("vetta:dialog:select-folder");
		ipcMain.removeHandler("vetta:dialog:select-files");
		ipcMain.removeHandler("vetta:dialog:open-file-contents");
		ipcMain.removeHandler("vetta:dialog:save-html");
		ipcMain.removeHandler("vetta:dialog:save-data");
		ipcMain.removeHandler("vetta:dialog:save-copy");
		ipcMain.removeHandler("vetta:dialog:select-folders");
	};
}
