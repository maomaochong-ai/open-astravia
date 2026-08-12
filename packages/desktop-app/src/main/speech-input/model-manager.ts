import { rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SpeechInputStatus } from "../../preload/api-types/speech-input.js";
import { type ApplicationCacheNamespace, ApplicationCacheService } from "../cache/application-cache-service.js";
import { type DownloadModelFile, downloadModelFile, ModelIntegrityError } from "./download-file.js";
import { type SpeechModelDefinition, WINDOWS_ZIPFORMER_MODEL } from "./model-catalog.js";

const CACHE_NAMESPACE = "speech-recognition";
const INSTALL_MARKER = "model.json";

export interface SpeechModelManagerOptions {
	platform?: NodeJS.Platform;
	arch?: string;
	cache?: ApplicationCacheNamespace;
	model?: SpeechModelDefinition;
	downloadFile?: DownloadModelFile;
	onStatus?: (status: SpeechInputStatus) => void;
}

export class SpeechModelManager {
	private readonly platform: NodeJS.Platform;
	private readonly arch: string;
	private readonly cache: ApplicationCacheNamespace;
	private readonly model: SpeechModelDefinition;
	private readonly downloadFile: DownloadModelFile;
	private readonly onStatus: (status: SpeechInputStatus) => void;
	private downloadController: AbortController | null = null;
	private downloadPromise: Promise<SpeechInputStatus> | null = null;
	private currentStatus: SpeechInputStatus | null = null;

	constructor(options: SpeechModelManagerOptions = {}) {
		this.platform = options.platform ?? process.platform;
		this.arch = options.arch ?? process.arch;
		this.cache = options.cache ?? new ApplicationCacheService().namespace(CACHE_NAMESPACE);
		this.model = options.model ?? WINDOWS_ZIPFORMER_MODEL;
		this.downloadFile = options.downloadFile ?? downloadModelFile;
		this.onStatus = options.onStatus ?? (() => undefined);
	}

	get supported(): boolean {
		return this.platform === "win32" && this.arch === "x64";
	}

	get modelDirectory(): string {
		return this.cache.path(this.model.id);
	}

	async getStatus(): Promise<SpeechInputStatus> {
		if (!this.supported) return this.publish("unsupported", 0, "unsupported-platform");
		if (this.currentStatus?.phase === "downloading") return this.currentStatus;
		return (await this.isInstalled())
			? this.publish("ready", this.model.totalBytes)
			: this.publish("missing-model", 0);
	}

	download(): Promise<SpeechInputStatus> {
		if (this.downloadPromise) return this.downloadPromise;
		this.downloadPromise = this.performDownload().finally(() => {
			this.downloadPromise = null;
			this.downloadController = null;
		});
		return this.downloadPromise;
	}

	cancelDownload(): void {
		this.downloadController?.abort();
	}

	private async performDownload(): Promise<SpeechInputStatus> {
		if (!this.supported) return this.publish("unsupported", 0, "unsupported-platform");
		if (await this.isInstalled()) return this.publish("ready", this.model.totalBytes);

		const controller = new AbortController();
		this.downloadController = controller;
		const temporaryDirectory = await this.cache.createTemporaryDirectory("model");
		let completedBytes = 0;
		this.publish("downloading", 0);

		try {
			for (const file of this.model.files) {
				await this.downloadFile(file, join(temporaryDirectory, file.name), controller.signal, (fileBytes) =>
					this.publish("downloading", completedBytes + fileBytes),
				);
				completedBytes += file.size;
			}
			await writeFile(
				join(temporaryDirectory, INSTALL_MARKER),
				JSON.stringify({ modelId: this.model.id, installedAt: new Date().toISOString() }),
				"utf8",
			);
			await this.cache.ensure();
			await rm(this.modelDirectory, { recursive: true, force: true });
			await rename(temporaryDirectory, this.modelDirectory);
			return this.publish("ready", this.model.totalBytes);
		} catch (error) {
			await rm(temporaryDirectory, { recursive: true, force: true });
			if (controller.signal.aborted) return this.publish("missing-model", 0);
			return this.publish(
				"error",
				completedBytes,
				error instanceof ModelIntegrityError ? "model-integrity-failed" : "model-download-failed",
			);
		}
	}

	private async isInstalled(): Promise<boolean> {
		try {
			await stat(join(this.modelDirectory, INSTALL_MARKER));
			const fileStats = await Promise.all(
				this.model.files.map(async (file) => ({ file, info: await stat(join(this.modelDirectory, file.name)) })),
			);
			return fileStats.every(({ file, info }) => info.isFile() && info.size === file.size);
		} catch {
			return false;
		}
	}

	private publish(
		phase: SpeechInputStatus["phase"],
		downloadedBytes: number,
		errorCode?: SpeechInputStatus["errorCode"],
	): SpeechInputStatus {
		const status: SpeechInputStatus = {
			supported: this.supported,
			phase,
			modelId: this.model.id,
			downloadedBytes: Math.min(downloadedBytes, this.model.totalBytes),
			totalBytes: this.model.totalBytes,
			...(errorCode ? { errorCode } : {}),
		};
		this.currentStatus = status;
		this.onStatus(status);
		return status;
	}
}
