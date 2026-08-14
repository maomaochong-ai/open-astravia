import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import type { SpeechModelPaths } from "./model-catalog.js";

type NativeHandle = object;

interface SherpaNativeAddon {
	createOnlineRecognizer(config: object): NativeHandle;
	createOnlineStream(recognizer: NativeHandle): NativeHandle;
	acceptWaveformOnline(stream: NativeHandle, waveform: { samples: Float32Array; sampleRate: number }): void;
	inputFinished(stream: NativeHandle): void;
	isOnlineStreamReady(recognizer: NativeHandle, stream: NativeHandle): boolean;
	decodeOnlineStream(recognizer: NativeHandle, stream: NativeHandle): void;
	isEndpoint(recognizer: NativeHandle, stream: NativeHandle): boolean;
	reset(recognizer: NativeHandle, stream: NativeHandle): void;
	getOnlineStreamResultAsJson(recognizer: NativeHandle, stream: NativeHandle): string;
}

interface RecognitionResult {
	text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function loadNativeAddon(): SherpaNativeAddon {
	const candidate: unknown = createRequire(import.meta.url)("sherpa-onnx-win-x64");
	if (!isRecord(candidate)) throw new Error("Invalid sherpa-onnx native module");
	const requiredFunctions = [
		"createOnlineRecognizer",
		"createOnlineStream",
		"acceptWaveformOnline",
		"inputFinished",
		"isOnlineStreamReady",
		"decodeOnlineStream",
		"isEndpoint",
		"reset",
		"getOnlineStreamResultAsJson",
	] as const;
	if (requiredFunctions.some((name) => typeof candidate[name] !== "function")) {
		throw new Error("Incomplete sherpa-onnx native module");
	}
	return candidate as unknown as SherpaNativeAddon;
}

function parseRecognitionResult(value: string): RecognitionResult {
	const parsed: unknown = JSON.parse(value);
	if (!isRecord(parsed) || typeof parsed.text !== "string") {
		throw new Error("Invalid sherpa-onnx recognition result");
	}
	return { text: parsed.text.trim() };
}

export interface SherpaRecognitionUpdate {
	partial?: string;
	final?: string;
}

export class SherpaStreamingRecognizer {
	private readonly addon: SherpaNativeAddon;
	private readonly recognizer: NativeHandle;
	private stream: NativeHandle | null = null;
	private lastPartial = "";

	constructor(
		model: SpeechModelPaths,
		private readonly sampleRate: number,
	) {
		this.addon = loadNativeAddon();
		this.recognizer = this.addon.createOnlineRecognizer({
			featConfig: { sampleRate, featureDim: 80 },
			modelConfig: {
				transducer: {
					encoder: model.encoder,
					decoder: model.decoder,
					joiner: model.joiner,
				},
				tokens: model.tokens,
				numThreads: Math.min(4, availableParallelism()),
				provider: "cpu",
				debug: 0,
			},
			decodingMethod: "greedy_search",
			maxActivePaths: 4,
			enableEndpoint: 1,
			rule1MinTrailingSilence: 2.4,
			rule2MinTrailingSilence: 1.2,
			rule3MinUtteranceLength: 20,
		});
	}

	start(): void {
		this.stream = this.addon.createOnlineStream(this.recognizer);
		this.lastPartial = "";
	}

	accept(samples: Float32Array): SherpaRecognitionUpdate {
		const stream = this.requireStream();
		this.addon.acceptWaveformOnline(stream, { samples, sampleRate: this.sampleRate });
		this.decodeReady(stream);
		const text = this.getText(stream);
		if (this.addon.isEndpoint(this.recognizer, stream)) {
			this.addon.reset(this.recognizer, stream);
			this.lastPartial = "";
			return text ? { final: text } : {};
		}
		if (text && text !== this.lastPartial) {
			this.lastPartial = text;
			return { partial: text };
		}
		return {};
	}

	stop(): SherpaRecognitionUpdate {
		const stream = this.requireStream();
		this.addon.inputFinished(stream);
		this.decodeReady(stream);
		const text = this.getText(stream);
		this.stream = null;
		this.lastPartial = "";
		return text ? { final: text } : {};
	}

	cancel(): void {
		this.stream = null;
		this.lastPartial = "";
	}

	private decodeReady(stream: NativeHandle): void {
		while (this.addon.isOnlineStreamReady(this.recognizer, stream)) {
			this.addon.decodeOnlineStream(this.recognizer, stream);
		}
	}

	private getText(stream: NativeHandle): string {
		return parseRecognitionResult(this.addon.getOnlineStreamResultAsJson(this.recognizer, stream)).text;
	}

	private requireStream(): NativeHandle {
		if (!this.stream) throw new Error("Speech recognition stream is not active");
		return this.stream;
	}
}
