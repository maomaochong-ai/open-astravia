import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { app, shell } from "electron";
import type { DownloadEvent, DownloadItem, DownloadStartParams } from "../../preload/api-types/downloads.js";

interface InternalState {
	items: Map<string, DownloadItem>;
	active: Set<string>;
	queue: string[];
	abortFns: Map<string, () => void>;
	rates: Map<string, { lastBytes: number; lastTs: number }>;
}

type DownloadEventSink = (event: DownloadEvent) => void;

const MAX_CONCURRENT = 2;
const STATE_FILE_NAME = "downloads.json";

export class DesktopDownloadService {
	private eventSink: DownloadEventSink | undefined;
	private readonly state: InternalState = {
		items: new Map(),
		active: new Set(),
		queue: [],
		abortFns: new Map(),
		rates: new Map(),
	};
	private readonly stateFilePath: string;

	constructor() {
		this.stateFilePath = join(this.getStoreDir(), STATE_FILE_NAME);
		for (const item of this.loadPersistedItems()) {
			if (item.status === "downloading" || item.status === "queued") {
				item.status = "paused";
				item.speedBytesPerSec = 0;
			}
			this.state.items.set(item.id, item);
		}
	}

	attachEventSink(sink: DownloadEventSink): () => void {
		this.eventSink = sink;
		return () => {
			if (this.eventSink === sink) this.eventSink = undefined;
		};
	}

	start(params: DownloadStartParams): DownloadItem {
		const dir = params.saveDir || this.getDefaultDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const inferredName = params.filename || decodeURIComponent(basename(new URL(params.url).pathname)) || "download";
		const finalPath = this.uniqueFilename(dir, inferredName);
		const item: DownloadItem = {
			id: this.makeId(),
			url: params.url,
			filename: basename(finalPath),
			path: finalPath,
			totalBytes: 0,
			receivedBytes: 0,
			status: "queued",
			createdAt: Date.now(),
		};
		this.state.items.set(item.id, item);
		this.state.queue.push(item.id);
		this.notifyAdded(item);
		this.pump(params.headers);
		return item;
	}

	pause(id: string): void {
		const item = this.state.items.get(id);
		if (!item) return;
		if (item.status === "downloading") {
			item.status = "paused";
			item.speedBytesPerSec = 0;
			this.state.abortFns.get(id)?.();
			this.state.abortFns.delete(id);
			this.state.active.delete(id);
			this.notifyUpdated(item);
			this.persist();
			this.pump();
		} else if (item.status === "queued") {
			item.status = "paused";
			const index = this.state.queue.indexOf(id);
			if (index >= 0) this.state.queue.splice(index, 1);
			this.notifyUpdated(item);
			this.persist();
		}
	}

	resume(id: string): void {
		const item = this.state.items.get(id);
		if (!item) return;
		if (item.status === "paused" || item.status === "failed") {
			item.status = "queued";
			item.error = undefined;
			this.state.queue.push(id);
			this.notifyUpdated(item);
			this.pump();
		}
	}

	cancel(id: string): void {
		const item = this.state.items.get(id);
		if (!item) return;
		this.state.abortFns.get(id)?.();
		this.state.abortFns.delete(id);
		this.state.active.delete(id);
		const queueIndex = this.state.queue.indexOf(id);
		if (queueIndex >= 0) this.state.queue.splice(queueIndex, 1);
		item.status = "canceled";
		item.speedBytesPerSec = 0;
		this.notifyUpdated(item);
		this.persist();
		this.pump();
	}

	async remove(id: string, deleteFile: boolean): Promise<void> {
		const item = this.state.items.get(id);
		if (!item) return;
		this.cancel(id);
		this.state.items.delete(id);
		if (deleteFile && existsSync(item.path)) {
			try {
				await rm(item.path, { force: true });
			} catch {
				// Ignore file cleanup failures and still remove the download record.
			}
		}
		this.notifyRemoved(id);
		this.persist();
	}

	list(): DownloadItem[] {
		return Array.from(this.state.items.values()).sort((a, b) => b.createdAt - a.createdAt);
	}

	async openFile(id: string): Promise<void> {
		const item = this.state.items.get(id);
		if (!item || !existsSync(item.path)) return;
		await shell.openPath(item.path);
	}

	showInFolder(id: string): void {
		const item = this.state.items.get(id);
		if (!item) return;
		shell.showItemInFolder(item.path);
	}

	getDefaultDir(): string {
		try {
			return app.getPath("downloads");
		} catch {
			return tmpdir();
		}
	}

	private getStoreDir(): string {
		const dir = join(app.getPath("userData"), "downloads");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		return dir;
	}

	private loadPersistedItems(): DownloadItem[] {
		try {
			if (!existsSync(this.stateFilePath)) return [];
			const raw = readFileSync(this.stateFilePath, "utf-8");
			const items = JSON.parse(raw) as DownloadItem[];
			return Array.isArray(items) ? items : [];
		} catch {
			return [];
		}
	}

	private persist(): void {
		try {
			const items = Array.from(this.state.items.values()).filter(
				(item) =>
					item.status === "completed" ||
					item.status === "failed" ||
					item.status === "canceled" ||
					item.status === "paused",
			);
			writeFileSync(this.stateFilePath, JSON.stringify(items, null, 2), "utf-8");
		} catch {
			// Download state persistence is best-effort.
		}
	}

	private emit(event: DownloadEvent): void {
		this.eventSink?.(event);
	}

	private notifyUpdated(item: DownloadItem): void {
		this.emit({ type: "updated", item: { ...item } });
	}

	private notifyAdded(item: DownloadItem): void {
		this.emit({ type: "added", item: { ...item } });
	}

	private notifyRemoved(id: string): void {
		this.emit({ type: "removed", id });
	}

	private uniqueFilename(dir: string, name: string): string {
		let candidate = join(dir, name);
		if (!existsSync(candidate)) return candidate;
		const extension = extname(name);
		const base = basename(name, extension);
		let index = 1;
		while (existsSync(candidate)) {
			candidate = join(dir, `${base} (${index})${extension}`);
			index += 1;
		}
		return candidate;
	}

	private ensureDir(path: string): void {
		const directory = dirname(path);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
	}

	private makeId(): string {
		return `dl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
	}

	private pump(headers?: Record<string, string>): void {
		while (this.state.active.size < MAX_CONCURRENT && this.state.queue.length > 0) {
			const id = this.state.queue.shift();
			if (!id) break;
			const item = this.state.items.get(id);
			if (!item || item.status !== "queued") continue;
			this.state.active.add(id);
			this.startTransfer(item, headers).catch((error: unknown) => {
				item.status = "failed";
				item.error = error instanceof Error ? error.message : String(error);
				this.notifyUpdated(item);
				this.state.active.delete(id);
				this.persist();
				this.pump(headers);
			});
		}
	}

	private startTransfer(item: DownloadItem, headers?: Record<string, string>): Promise<void> {
		return new Promise((resolve, reject) => {
			const url = new URL(item.url);
			const isHttps = url.protocol === "https:";
			const requester = isHttps ? httpsRequest : httpRequest;
			let resumeFrom = 0;
			if (existsSync(item.path)) {
				try {
					const file = statSync(item.path);
					resumeFrom = file.size;
					item.receivedBytes = resumeFrom;
				} catch {
					resumeFrom = 0;
				}
			}

			const requestHeaders: Record<string, string> = { ...(headers ?? {}) };
			if (resumeFrom > 0) requestHeaders.Range = `bytes=${resumeFrom}-`;

			item.status = "downloading";
			this.notifyUpdated(item);
			const request = requester(
				{
					protocol: url.protocol,
					hostname: url.hostname,
					port: url.port || (isHttps ? 443 : 80),
					path: `${url.pathname}${url.search}`,
					method: "GET",
					headers: requestHeaders,
				},
				(response) => {
					if (
						response.statusCode &&
						response.statusCode >= 300 &&
						response.statusCode < 400 &&
						response.headers.location
					) {
						item.url = new URL(response.headers.location, url).toString();
						response.resume();
						this.startTransfer(item, headers).then(resolve, reject);
						return;
					}

					if (response.statusCode === 416) {
						item.status = "completed";
						item.completedAt = Date.now();
						this.notifyUpdated(item);
						this.state.active.delete(item.id);
						this.persist();
						this.pump(headers);
						resolve();
						return;
					}

					if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
						reject(new Error(`HTTP ${response.statusCode}`));
						return;
					}

					const lengthHeader = response.headers["content-length"];
					const partLength = lengthHeader ? Number(lengthHeader) : 0;
					if (response.statusCode === 206) {
						const contentRange = response.headers["content-range"];
						if (contentRange) {
							const match = /\/(\d+)$/.exec(contentRange);
							if (match) item.totalBytes = Number(match[1]);
						}
					} else {
						item.totalBytes = partLength;
						item.receivedBytes = 0;
						if (existsSync(item.path)) this.removeFileSync(item.path);
					}
					this.notifyUpdated(item);

					this.ensureDir(item.path);
					const writeStream = createWriteStream(item.path, {
						flags: resumeFrom > 0 && response.statusCode === 206 ? "a" : "w",
					});
					let aborted = false;
					const abort = () => {
						aborted = true;
						request.destroy();
						writeStream.destroy();
					};
					this.state.abortFns.set(item.id, abort);
					this.state.rates.set(item.id, { lastBytes: item.receivedBytes, lastTs: Date.now() });

					response.on("data", (chunk: Buffer) => {
						if (aborted) return;
						writeStream.write(chunk);
						item.receivedBytes += chunk.length;
						this.updateRate(item);
						this.notifyUpdated(item);
					});

					response.on("end", () => {
						if (aborted) return;
						writeStream.end();
						writeStream.on("close", () => {
							this.state.abortFns.delete(item.id);
							this.state.rates.delete(item.id);
							this.state.active.delete(item.id);
							if (item.status !== "canceled" && item.status !== "paused") {
								item.status = "completed";
								item.completedAt = Date.now();
								this.notifyUpdated(item);
							}
							this.persist();
							this.pump(headers);
							resolve();
						});
					});

					response.on("error", (error) => {
						writeStream.destroy();
						this.state.abortFns.delete(item.id);
						this.state.rates.delete(item.id);
						this.state.active.delete(item.id);
						reject(error);
					});
				},
			);

			request.on("error", (error) => {
				this.state.abortFns.delete(item.id);
				this.state.rates.delete(item.id);
				this.state.active.delete(item.id);
				reject(error);
			});
			request.end();
		});
	}

	private removeFileSync(path: string): void {
		try {
			rmSync(path, { force: true });
		} catch {
			// Existing partial download cleanup is best-effort.
		}
	}

	private updateRate(item: DownloadItem): void {
		const rate = this.state.rates.get(item.id);
		if (!rate) return;
		const now = Date.now();
		const elapsed = now - rate.lastTs;
		if (elapsed < 500) return;
		const received = item.receivedBytes - rate.lastBytes;
		item.speedBytesPerSec = Math.round((received / elapsed) * 1000);
		rate.lastBytes = item.receivedBytes;
		rate.lastTs = now;
	}
}

let sharedDownloadService: DesktopDownloadService | undefined;

export function getDesktopDownloadService(): DesktopDownloadService {
	sharedDownloadService ??= new DesktopDownloadService();
	return sharedDownloadService;
}
