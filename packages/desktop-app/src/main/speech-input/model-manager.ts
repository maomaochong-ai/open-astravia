import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { SpeechInputStatus } from "../../preload/api-types/speech-input.js";
import { type SpeechModelDefinition, WINDOWS_ZIPFORMER_MODEL } from "./model-catalog.js";

export interface SpeechModelManagerOptions {
	platform?: NodeJS.Platform;
	arch?: string;
	modelRoot: string;
	model?: SpeechModelDefinition;
}

/**
 * Runtime view of a model prepared by the build pipeline.
 *
 * This class intentionally has no network or cache responsibilities. Packaged
 * applications only consume immutable files from Electron extraResources.
 */
export class SpeechModelManager {
	private readonly platform: NodeJS.Platform;
	private readonly arch: string;
	private readonly model: SpeechModelDefinition;
	private readonly modelRoot: string;

	constructor(options: SpeechModelManagerOptions) {
		this.platform = options.platform ?? process.platform;
		this.arch = options.arch ?? process.arch;
		this.modelRoot = options.modelRoot;
		this.model = options.model ?? WINDOWS_ZIPFORMER_MODEL;
	}

	get supported(): boolean {
		return this.platform === "win32" && this.arch === "x64";
	}

	get modelDirectory(): string {
		return join(this.modelRoot, this.model.id);
	}

	async getStatus(): Promise<SpeechInputStatus> {
		if (!this.supported) return this.status("unsupported", "unsupported-platform");

		try {
			const fileStats = await Promise.all(
				this.model.files.map(async (file) => ({ file, info: await stat(join(this.modelDirectory, file.name)) })),
			);
			const valid = fileStats.every(({ file, info }) => info.isFile() && info.size === file.size);
			return valid ? this.status("ready") : this.status("unavailable", "bundled-model-invalid");
		} catch {
			return this.status("unavailable", "bundled-model-missing");
		}
	}

	private status(phase: SpeechInputStatus["phase"], errorCode?: SpeechInputStatus["errorCode"]): SpeechInputStatus {
		return {
			supported: this.supported,
			phase,
			modelId: this.model.id,
			...(errorCode ? { errorCode } : {}),
		};
	}
}
