export type SpeechInputPhase =
	| "unsupported"
	| "missing-model"
	| "downloading"
	| "ready"
	| "loading"
	| "listening"
	| "stopping"
	| "error";

export type SpeechInputErrorCode =
	| "unsupported-platform"
	| "model-download-failed"
	| "model-integrity-failed"
	| "recognizer-start-failed"
	| "recognizer-failed";

export interface SpeechInputStatus {
	supported: boolean;
	phase: SpeechInputPhase;
	modelId: string;
	downloadedBytes: number;
	totalBytes: number;
	errorCode?: SpeechInputErrorCode;
}

export type SpeechInputEvent =
	| { type: "status"; status: SpeechInputStatus }
	| { type: "partial"; sessionId: string; text: string }
	| { type: "final"; sessionId: string; text: string }
	| { type: "error"; sessionId?: string; code: SpeechInputErrorCode };

export interface DesktopSpeechInputApi {
	getStatus(): Promise<SpeechInputStatus>;
	downloadModel(): Promise<SpeechInputStatus>;
	cancelDownload(): Promise<void>;
	start(): Promise<{ sessionId: string }>;
	pushAudio(sessionId: string, samples: Float32Array): void;
	stop(sessionId: string): Promise<void>;
	cancel(sessionId: string): Promise<void>;
	onEvent(handler: (event: SpeechInputEvent) => void): () => void;
}
