/**
 * Maps Codex MCP App widget bridge → Vetta plugin host APIs.
 * App.jsx talks to window.cowartMcp / window.openai; we install those shims.
 */
import type { PluginContext, PluginFsApi } from "@vetta-org/plugin-sdk";

const PAGE_ID_PREFIX = "page:";
const PAGE_ASSETS_ROUTE = "/page-assets/";
const GLOBAL_ASSETS_ROUTE = "/assets/";
const CANVAS_FILE = "cowart-canvas.json";

export type CowartBridgeOptions = {
	projectDir: string;
	fs: PluginFsApi;
	sendPrompt: (text: string) => Promise<void>;
};

type Json = unknown;

function joinPath(root: string, ...parts: string[]): string {
	const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	let out = root.replace(/[/\\]+$/, "");
	for (const part of parts) {
		const clean = String(part).replace(/^[/\\]+/, "").replace(/[/\\]+/g, sep);
		out = `${out}${sep}${clean}`;
	}
	return out;
}

function canvasDirOf(projectDir: string): string {
	return joinPath(projectDir, "canvas");
}

function pageDirName(pageId: string): string {
	return encodeURIComponent(String(pageId).replace(PAGE_ID_PREFIX, ""));
}

function isCanvasSnapshot(value: unknown): value is { store: Record<string, unknown>; schema: unknown } {
	return Boolean(value && typeof value === "object" && (value as { store?: unknown }).store && (value as { schema?: unknown }).schema);
}

async function readJson(fs: PluginFsApi, path: string): Promise<Json | null> {
	const stat = await fs.stat(path);
	if (!stat) return null;
	const file = await fs.readFile(path);
	if (!file.content) return null;
	return JSON.parse(file.content) as Json;
}

async function writeJson(fs: PluginFsApi, path: string, payload: unknown): Promise<void> {
	const parent = path.replace(/[/\\][^/\\]+$/, "");
	await fs.createDirectory(parent);
	await fs.writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function loadSnapshot(fs: PluginFsApi, projectDir: string) {
	const canvasDir = canvasDirOf(projectDir);
	const pagesDir = joinPath(canvasDir, "pages");
	const manifestPath = joinPath(pagesDir, "manifest.json");
	const legacyPath = joinPath(canvasDir, CANVAS_FILE);

	const manifest = (await readJson(fs, manifestPath)) as { pages?: Array<{ id: string }> } | null;
	if (manifest?.pages?.length) {
		const store: Record<string, unknown> = {};
		let schema: unknown = null;
		for (const page of manifest.pages) {
			const pagePath = joinPath(pagesDir, pageDirName(page.id), CANVAS_FILE);
			const snap = (await readJson(fs, pagePath)) as { store?: Record<string, unknown>; schema?: unknown } | null;
			if (!snap || !isCanvasSnapshot(snap)) continue;
			schema = snap.schema;
			Object.assign(store, snap.store);
		}
		if (schema) {
			return {
				snapshot: { schema, store },
				path: pagesDir,
				storage: "per-page" as const,
			};
		}
	}

	const legacy = await readJson(fs, legacyPath);
	if (legacy && isCanvasSnapshot(legacy)) {
		return { snapshot: legacy, path: legacyPath, storage: "legacy-single-file" as const };
	}

	return { snapshot: null, path: pagesDir, storage: "empty" as const };
}

async function saveSnapshot(fs: PluginFsApi, projectDir: string, snapshot: unknown) {
	if (!isCanvasSnapshot(snapshot)) {
		return { ok: false, storage: "invalid", paths: [] as string[] };
	}
	const canvasDir = canvasDirOf(projectDir);
	const pagesDir = joinPath(canvasDir, "pages");
	const pages = Object.values(snapshot.store).filter(
		(record) => record && typeof record === "object" && (record as { typeName?: string }).typeName === "page",
	) as Array<{ id: string; name?: string; index?: string }>;

	if (pages.length === 0) {
		const path = joinPath(canvasDir, CANVAS_FILE);
		await writeJson(fs, path, snapshot);
		return { ok: true, storage: "legacy-single-file", paths: [path] };
	}

	// Full multi-page split is complex (asset localization). For Vetta 1:1 UX we still
	// persist a merged snapshot per page file + root legacy for MCP compatibility.
	const paths: string[] = [];
	const legacyPath = joinPath(canvasDir, CANVAS_FILE);
	await writeJson(fs, legacyPath, snapshot);
	paths.push(legacyPath);

	const manifest = {
		version: 1,
		source: "cowart-vetta",
		pages: pages.map((page) => ({
			id: page.id,
			name: page.name,
			index: page.index,
			path: `pages/${pageDirName(page.id)}/${CANVAS_FILE}`,
		})),
	};
	await writeJson(fs, joinPath(pagesDir, "manifest.json"), manifest);

	for (const page of pages) {
		const pagePath = joinPath(pagesDir, pageDirName(page.id), CANVAS_FILE);
		// Page-local slice: keep full schema/store for simplicity (MCP can still merge).
		await writeJson(fs, pagePath, snapshot);
		paths.push(pagePath);
	}

	return { ok: true, storage: "per-page+legacy", paths };
}

function parseDataUrl(src: string): { mimeType: string; base64: string } | null {
	const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(src);
	if (!match) return null;
	return { mimeType: match[1] || "application/octet-stream", base64: match[2] };
}

function assetFileFromUrl(projectDir: string, assetUrl: string): string | null {
	const canvasDir = canvasDirOf(projectDir);
	if (assetUrl.startsWith(PAGE_ASSETS_ROUTE)) {
		const rest = assetUrl.slice(PAGE_ASSETS_ROUTE.length);
		const [pageEnc, ...fileParts] = rest.split("/");
		if (!pageEnc || fileParts.length === 0) return null;
		const pageDir = decodeURIComponent(pageEnc);
		const fileName = fileParts.map(decodeURIComponent).join("/");
		return joinPath(canvasDir, "pages", pageDir, "assets", fileName);
	}
	if (assetUrl.startsWith(GLOBAL_ASSETS_ROUTE)) {
		const rest = decodeURIComponent(assetUrl.slice(GLOBAL_ASSETS_ROUTE.length));
		return joinPath(canvasDir, "assets", rest);
	}
	return null;
}

function extractPromptText(message: unknown): string {
	if (typeof message === "string") return message;
	if (!message || typeof message !== "object") return "";
	const m = message as { prompt?: string; content?: unknown };
	if (typeof m.prompt === "string") return m.prompt;
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) {
		return m.content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
					return String((part as { text?: string }).text ?? "");
				}
				if (part && typeof part === "object" && (part as { type?: string }).type === "image") {
					const p = part as { data?: string; path?: string; mimeType?: string };
					if (p.path) return `[image: ${p.path}]`;
					if (p.data) return `[image attached mime=${p.mimeType ?? "image/png"}]`;
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

export function installCowartVettaBridge(options: CowartBridgeOptions): () => void {
	const { projectDir, fs, sendPrompt } = options;
	const canvasDir = canvasDirOf(projectDir);

	const callServerTool = async (request: { name: string; arguments?: Record<string, unknown> }) => {
		const name = request.name;
		// 显式标注：展开 Record<string, unknown> 不会带出索引签名，缺了它
		// args.snapshot / args.dataUrl 等调用方参数会被判成不存在。
		const args: Record<string, unknown> = { projectDir, canvasDir, ...(request.arguments ?? {}) };

		try {
			if (name === "get_cowart_canvas_state") {
				const loaded = await loadSnapshot(fs, projectDir);
				const viewStateFile = joinPath(canvasDir, "cowart-view-state.json");
				const viewRaw = await readJson(fs, viewStateFile);
				const selectionFile = joinPath(canvasDir, "cowart-selection.json");
				return {
					structuredContent: {
						version: 1,
						projectDir,
						canvasDir,
						snapshot: loaded.snapshot,
						path: loaded.path,
						storage: loaded.storage,
						viewState: viewRaw ?? {
							version: 1,
							currentPageId: null,
							camera: { x: 0, y: 0, z: 1 },
							updatedAt: null,
						},
						viewStateFile,
						selectionFile,
						hydratedAssets: [],
					},
				};
			}

			if (name === "save_cowart_canvas_state") {
				const snapshot = args.snapshot;
				const result = await saveSnapshot(fs, projectDir, snapshot);
				return { structuredContent: result };
			}

			if (name === "save_cowart_selection_state") {
				const selection = args.selection ?? { selectedShapes: [] };
				const path = joinPath(canvasDir, "cowart-selection.json");
				const payload = { ...(selection as object), updatedAt: new Date().toISOString() };
				await writeJson(fs, path, payload);
				return { structuredContent: { ok: true, path, selection: payload } };
			}

			if (name === "save_cowart_view_state") {
				const viewState = args.viewState ?? {
					version: 1,
					currentPageId: null,
					camera: { x: 0, y: 0, z: 1 },
				};
				const path = joinPath(canvasDir, "cowart-view-state.json");
				const payload = { ...(viewState as object), updatedAt: new Date().toISOString() };
				await writeJson(fs, path, payload);
				return { structuredContent: { ok: true, path, viewState: payload } };
			}

			if (name === "save_cowart_reference_image") {
				const pageId = String(args.pageId || args.anchorShapeId || "page:page");
				const dataUrl = String(args.dataUrl || "");
				const parsed = parseDataUrl(dataUrl);
				if (!parsed) throw new Error("save_cowart_reference_image requires dataUrl base64 image");
				const fileName = String(args.fileName || `reference-${Date.now()}.png`);
				const assetPath = joinPath(canvasDir, "pages", pageDirName(pageId), "assets", fileName);
				await fs.createDirectory(joinPath(canvasDir, "pages", pageDirName(pageId), "assets"));
				await fs.writeFile(assetPath, parsed.base64, "base64");
				const assetUrl = `${PAGE_ASSETS_ROUTE}${pageDirName(pageId)}/${encodeURIComponent(fileName)}`;
				return {
					structuredContent: {
						ok: true,
						canvasDir,
						pageId,
						fileName,
						assetPath,
						assetUrl,
						mimeType: parsed.mimeType,
					},
				};
			}

			if (name === "read_cowart_page_asset") {
				const assetUrl = String(args.assetUrl || "");
				const filePath = assetFileFromUrl(projectDir, assetUrl);
				if (!filePath) throw new Error(`Unsupported asset URL: ${assetUrl}`);
				const file = await fs.readFile(filePath);
				const content =
					file.encoding === "base64"
						? file.content
						: btoa(unescape(encodeURIComponent(file.content)));
				return {
					structuredContent: {
						ok: true,
						canvasDir,
						assetUrl,
						assetPath: filePath,
						mimeType: "application/octet-stream",
						dataBase64: content,
					},
				};
			}

			if (name === "download_cowart_file") {
				// Best-effort: write under project canvas/exports
				const dataUrl = String(args.dataUrl || "");
				const fileName = String(args.fileName || `export-${Date.now()}.bin`);
				const parsed = parseDataUrl(dataUrl);
				const exportDir = joinPath(projectDir, "canvas", "exports");
				await fs.createDirectory(exportDir);
				const filePath = joinPath(exportDir, fileName);
				if (parsed) {
					await fs.writeFile(filePath, parsed.base64, "base64");
				} else if (typeof args.dataBase64 === "string") {
					await fs.writeFile(filePath, args.dataBase64, "base64");
				} else {
					throw new Error("download_cowart_file needs dataUrl or dataBase64");
				}
				return {
					structuredContent: {
						ok: true,
						fileName,
						filePath,
						directoryPath: exportDir,
					},
				};
			}

			if (name === "insert_cowart_html_draft" || name === "insert_cowart_image") {
				// Agent-facing tools remain on MCP process; UI rarely calls these via bridge.
				return {
					isError: true,
					content: [{ type: "text", text: `${name} should be invoked via agent MCP tools in Vetta.` }],
				};
			}

			return {
				isError: true,
				content: [{ type: "text", text: `Unsupported Cowart bridge tool: ${name}` }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { isError: true, content: [{ type: "text", text: message }] };
		}
	};

	const previousCowartMcp = (window as unknown as { cowartMcp?: unknown }).cowartMcp;
	const previousOpenai = (window as unknown as { openai?: unknown }).openai;

	const cowartMcp = {
		callServerTool: async (req: { name: string; arguments?: Record<string, unknown> }) => callServerTool(req),
		/**
		 * Dispatch a follow-up into the active Vetta conversation.
		 * Must not await the full agent turn — session.prompt only resolves when the
		 * agent finishes, which would leave AI Image/HTML/Slides UI stuck on「发送中」
		 * while generate_image / edit_image run for a long time.
		 */
		sendFollowUpMessage: async (message: unknown) => {
			const text = extractPromptText(message);
			if (!text.trim()) throw new Error("Missing follow-up prompt text");
			const sendPromise = sendPrompt(text);
			// Fail fast on immediate setup errors (no session / validation).
			// After a short grace window, resolve so canvas UI can leave "sending".
			const outcome = await Promise.race([
				sendPromise.then(
					() => "done" as const,
					(err: unknown) => {
						throw err;
					},
				),
				new Promise<"started">((resolve) => {
					window.setTimeout(() => resolve("started"), 200);
				}),
			]);
			if (outcome === "started") {
				void sendPromise.catch((err: unknown) => {
					console.error("[cowart-vetta] conversation.sendPrompt failed after dispatch:", err);
				});
			}
			return {};
		},
		getHostCapabilities: () => ({
			message: { image: false },
			followUp: true,
		}),
	};

	(window as unknown as { cowartMcp: typeof cowartMcp }).cowartMcp = cowartMcp;
	(window as unknown as { openai: Record<string, unknown> }).openai = {
		...(typeof previousOpenai === "object" && previousOpenai ? previousOpenai : {}),
		toolOutput: { projectDir, canvasDir, mode: "vetta" },
		hostCapabilities: { message: { image: false }, followUp: true },
		sendFollowUpMessage: cowartMcp.sendFollowUpMessage,
	};

	// Notify App.jsx listeners that host globals are ready.
	window.dispatchEvent(new CustomEvent("openai:set_globals", { detail: { globals: (window as unknown as { openai: unknown }).openai } }));

	return () => {
		// Only restore if we still own the globals (another install may have replaced us).
		const win = window as unknown as { cowartMcp?: unknown; openai?: unknown };
		if (win.cowartMcp === cowartMcp) win.cowartMcp = previousCowartMcp;
		if (win.openai && (win.openai as { toolOutput?: { mode?: string } }).toolOutput?.mode === "vetta") {
			win.openai = previousOpenai;
		}
	};
}

/**
 * Ref-counted bridge with deferred release so React Strict Mode
 * (mount → unmount → remount) does not drop window.cowartMcp while
 * App.jsx async loadCowartCanvasState is still in flight.
 */
type BridgeHold = {
	key: string;
	dispose: () => void;
	refs: number;
	releaseTimer: ReturnType<typeof setTimeout> | null;
};

let bridgeHold: BridgeHold | null = null;
const BRIDGE_RELEASE_MS = 100;

export function installBridgeFromPluginContext(ctx: PluginContext, projectDir: string): () => void {
	const key = projectDir;
	if (bridgeHold?.releaseTimer != null) {
		clearTimeout(bridgeHold.releaseTimer);
		bridgeHold.releaseTimer = null;
	}
	if (!bridgeHold || bridgeHold.key !== key) {
		bridgeHold?.dispose();
		bridgeHold = {
			key,
			dispose: installCowartVettaBridge({
				projectDir,
				fs: ctx.fs,
				sendPrompt: (text) => ctx.conversation.sendPrompt(text),
			}),
			refs: 0,
			releaseTimer: null,
		};
	}
	bridgeHold.refs += 1;
	let released = false;
	return () => {
		if (released || !bridgeHold) return;
		released = true;
		bridgeHold.refs -= 1;
		if (bridgeHold.refs > 0) return;
		const hold = bridgeHold;
		hold.releaseTimer = setTimeout(() => {
			if (bridgeHold === hold && hold.refs <= 0) {
				hold.dispose();
				if (bridgeHold === hold) bridgeHold = null;
			}
		}, BRIDGE_RELEASE_MS);
	};
}
