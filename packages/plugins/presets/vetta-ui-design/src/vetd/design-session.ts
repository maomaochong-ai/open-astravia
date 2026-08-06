import type { Disposable, PluginContext } from "@vetta-org/plugin-sdk";
import { isFrameFile } from "../../engine/src/routes";
import { type ParsedFrameMeta, parseFrameMeta, sameMeta, sanitizeFrameTitle, withFrameTitle } from "./frame-meta";
import { FALLBACK_FRAME_SIZE, resolveFrameSizes } from "./frame-size";
import {
	designNameOf,
	emptyManifest,
	sidecarDirOf,
	type VetdCanvasViewport,
	type VetdFrameEntry,
	type VetdManifest,
} from "./manifest-types";
import { blankFrameSource } from "./scaffold";

const FRAME_GAP = 80;
const RECONCILE_DEBOUNCE_MS = 150;
const VIEWPORT_SAVE_DEBOUNCE_MS = 800;

export type DesignChange = "frames" | "theme";

/**
 * One open working-form design. Owns the manifest (single writer): the agent
 * and the user only touch sidecar sources; every manifest mutation flows
 * through this class. Reconcile rules (ADR-0053): tsx meta is the DECLARATION
 * (initial size / follow on change), the manifest is the CURRENT state (user
 * drags win until the meta changes again).
 */
export class DesignSession {
	readonly vetdPath: string;
	readonly dirPath: string;
	readonly name: string;
	manifest: VetdManifest = emptyManifest();

	private readonly ctx: PluginContext;
	private readonly listeners = new Set<(change: DesignChange) => void>();
	private readonly watchHandles: Disposable[] = [];
	private readonly pendingPlacements = new Map<string, { x: number; y: number }>();
	private reconcileTimer: number | null = null;
	private viewportTimer: number | null = null;
	private disposed = false;
	private writing = Promise.resolve();

	constructor(ctx: PluginContext, vetdPath: string) {
		this.ctx = ctx;
		this.vetdPath = vetdPath;
		this.dirPath = sidecarDirOf(vetdPath);
		this.name = designNameOf(vetdPath);
	}

	on(listener: (change: DesignChange) => void): Disposable {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	private emit(change: DesignChange): void {
		for (const listener of this.listeners) listener(change);
	}

	async open(): Promise<void> {
		try {
			const raw = await this.ctx.fs.readFile(this.vetdPath);
			const parsed = JSON.parse(raw.content) as VetdManifest;
			if (parsed && parsed.type === "vetta-design" && Array.isArray(parsed.frames)) {
				this.manifest = {
					...emptyManifest(),
					...parsed,
					canvas: { ...emptyManifest().canvas, ...parsed.canvas },
				};
			}
		} catch {
			// Corrupt/missing manifest: rebuild from the sidecar (frames re-place).
			this.manifest = emptyManifest();
		}
		await this.reconcile();
		const schedule = () => this.scheduleReconcile();
		this.watchHandles.push(this.ctx.fs.watchDirectory(this.dirPath, schedule));
		this.watchHandles.push(this.ctx.fs.watchDirectory(`${this.dirPath}/frames`, schedule));
	}

	dispose(): void {
		this.disposed = true;
		for (const handle of this.watchHandles) handle.dispose();
		this.watchHandles.length = 0;
		if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
		if (this.viewportTimer !== null) window.clearTimeout(this.viewportTimer);
		this.listeners.clear();
	}

	private scheduleReconcile(): void {
		if (this.disposed) return;
		if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
		this.reconcileTimer = window.setTimeout(() => {
			this.reconcileTimer = null;
			void this.reconcile().then(() => {
				// theme.css edits arrive through the same watch; re-reading the palette
				// is cheap, so always signal it.
				this.emit("theme");
			});
		}, RECONCILE_DEBOUNCE_MS);
	}

	/** Scan `frames/*.tsx`, apply the meta/manifest ownership rules, persist if changed. */
	async reconcile(): Promise<void> {
		if (this.disposed) return;
		let files: { name: string; path: string }[] = [];
		try {
			const entries = await this.ctx.fs.readDir(`${this.dirPath}/frames`);
			files = entries
				// isFrameFile 排掉 `_` 开头的路由结构件（`_layout.tsx`）：它是公共外壳，
				// 不是一屏内容，画布上不该为它多出一个空画板。
				.filter((entry) => !entry.isDirectory && entry.name.endsWith(".tsx") && isFrameFile(entry.name))
				.map((entry) => ({ name: entry.name, path: entry.path }));
		} catch {
			files = [];
		}

		const nextFrames: VetdFrameEntry[] = [];
		const known = new Map(this.manifest.frames.map((frame) => [frame.id, frame]));
		let dirty = false;

		const sorted = files.sort((a, b) => a.name.localeCompare(b.name));
		const parsedFiles: { file: { name: string; path: string }; id: string; parsed: ParsedFrameMeta }[] = [];
		for (const file of sorted) {
			const id = file.name.replace(/\.tsx$/, "");
			let source = "";
			try {
				source = (await this.ctx.fs.readFile(file.path)).content;
			} catch {
				// unreadable frame: keep going with defaults
			}
			parsedFiles.push({ file, id, parsed: parseFrameMeta(source, id) });
		}
		// 尺寸解析先于建条目：漏声明的画框拿多数派尺寸上画布，而不是掉出去。缺声明
		// 本身照常由 checkSources 报成 `frame-size-missing`——渲染和报错是两件事。
		const sizes = resolveFrameSizes(
			parsedFiles.map(({ id, parsed }) => ({ id, parsed, existing: known.get(id)?.meta ?? null })),
		);

		for (const { file, id, parsed } of parsedFiles) {
			const existing = known.get(id);
			const size = sizes.get(id) ?? FALLBACK_FRAME_SIZE;
			const meta = { width: size.width, height: size.height, title: parsed.title };
			if (!existing) {
				const placement = this.pendingPlacements.get(id) ?? this.autoPlacement(nextFrames);
				this.pendingPlacements.delete(id);
				nextFrames.push({
					id,
					file: `frames/${file.name}`,
					x: placement.x,
					y: placement.y,
					width: meta.width,
					height: meta.height,
					title: meta.title,
					meta,
				});
				dirty = true;
				continue;
			}
			known.delete(id);
			if (!sameMeta(meta, existing.meta)) {
				// Agent changed the declaration → manifest follows (last writer wins).
				nextFrames.push({ ...existing, width: meta.width, height: meta.height, title: meta.title, meta });
				dirty = true;
			} else {
				nextFrames.push(existing);
			}
		}
		if (known.size > 0) dirty = true; // deleted frames

		this.manifest = { ...this.manifest, frames: nextFrames };
		if (dirty) await this.persist();
		this.emit("frames");
	}

	private autoPlacement(placed: VetdFrameEntry[]): { x: number; y: number } {
		const all = [...this.manifest.frames, ...placed];
		if (all.length === 0) return { x: 0, y: 0 };
		const right = Math.max(...all.map((frame) => frame.x + frame.width));
		const top = Math.min(...all.map((frame) => frame.y));
		return { x: right + FRAME_GAP, y: top };
	}

	/** User drag/resize on the canvas — manifest-only, never written back to tsx. */
	updateFramePlacement(id: string, patch: Partial<Pick<VetdFrameEntry, "x" | "y" | "width" | "height">>): void {
		let changed = false;
		this.manifest = {
			...this.manifest,
			frames: this.manifest.frames.map((frame) => {
				if (frame.id !== id) return frame;
				changed = true;
				return { ...frame, ...patch };
			}),
		};
		if (!changed) return;
		this.emit("frames");
		void this.persist();
	}

	/**
	 * 一次落多个 frame 的位置（自动排列、拖 gap、多选拖动）。
	 *
	 * 逐个调 {@link updateFramePlacement} 也能达到同样结果，但那是 N 次 emit + N 次
	 * 写盘：二十帧的整理会让画布连着重渲染二十遍，写队列也排二十个。
	 */
	updateFramePlacements(
		patches: ReadonlyMap<string, Partial<Pick<VetdFrameEntry, "x" | "y" | "width" | "height">>>,
	): void {
		if (patches.size === 0) return;
		let changed = false;
		this.manifest = {
			...this.manifest,
			frames: this.manifest.frames.map((frame) => {
				const patch = patches.get(frame.id);
				if (!patch) return frame;
				changed = true;
				return { ...frame, ...patch };
			}),
		};
		if (!changed) return;
		this.emit("frames");
		void this.persist();
	}

	saveViewport(viewport: VetdCanvasViewport): void {
		this.manifest = { ...this.manifest, canvas: viewport };
		if (this.viewportTimer !== null) window.clearTimeout(this.viewportTimer);
		this.viewportTimer = window.setTimeout(() => {
			this.viewportTimer = null;
			void this.persist();
		}, VIEWPORT_SAVE_DEBOUNCE_MS);
	}

	/** Canvas "Frame" tool: scaffold a blank frame tsx at an explicit canvas spot. */
	async createFrame(title: string, width: number, height: number, x: number, y: number): Promise<string> {
		const existing = new Set(this.manifest.frames.map((frame) => frame.id));
		let index = this.manifest.frames.length + 1;
		let id = `frame-${index}`;
		while (existing.has(id)) {
			index += 1;
			id = `frame-${index}`;
		}
		this.pendingPlacements.set(id, { x, y });
		await this.ctx.fs.writeFile(`${this.dirPath}/frames/${id}.tsx`, blankFrameSource(title, width, height));
		await this.reconcile();
		return id;
	}

	/**
	 * 画布上重命名 frame：写回 tsx 的 meta 声明（标题的真相在那里），manifest 先
	 * 乐观更新——文件监听到 reconcile 有防抖，等它回来标题会先跳回旧值再变。
	 */
	async renameFrame(id: string, rawTitle: string): Promise<void> {
		const frame = this.manifest.frames.find((entry) => entry.id === id);
		if (!frame) return;
		const title = sanitizeFrameTitle(rawTitle);
		if (!title || title === frame.title) return;
		const path = `${this.dirPath}/${frame.file}`;
		const source = (await this.ctx.fs.readFile(path)).content;
		const next = withFrameTitle(source, title);
		if (next === null) throw new Error(`frame meta declaration not found in ${frame.file}`);
		this.manifest = {
			...this.manifest,
			frames: this.manifest.frames.map((entry) =>
				entry.id === id ? { ...entry, title, meta: { ...entry.meta, title } } : entry,
			),
		};
		this.emit("frames");
		await this.ctx.fs.writeFile(path, next);
		await this.persist();
	}

	/**
	 * 画布右键「删除 Frame」：sidecar 里的 tsx 才是真相，删掉源码后 reconcile
	 * 自然会把它从 manifest 里摘掉，不必单独改 manifest。
	 */
	async deleteFrame(id: string): Promise<void> {
		const frame = this.manifest.frames.find((entry) => entry.id === id);
		if (!frame) return;
		await this.ctx.fs.delete(`${this.dirPath}/${frame.file}`);
		await this.reconcile();
	}

	async readThemeCss(): Promise<string> {
		try {
			return (await this.ctx.fs.readFile(`${this.dirPath}/theme.css`)).content;
		} catch {
			return "";
		}
	}

	private persist(): Promise<void> {
		// Serialize writes so rapid drag updates cannot interleave.
		const snapshot = `${JSON.stringify(this.manifest, null, "\t")}\n`;
		this.writing = this.writing
			.then(() => this.ctx.fs.writeFile(this.vetdPath, snapshot))
			.catch((error: unknown) => {
				console.error("vetd manifest write failed", error);
			});
		return this.writing;
	}
}
