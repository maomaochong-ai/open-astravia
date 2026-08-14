export type SpeechInputPhase = "unsupported" | "unavailable" | "ready" | "loading" | "listening" | "stopping" | "error";

export type SpeechInputErrorCode =
	| "unsupported-platform"
	| "bundled-model-missing"
	| "bundled-model-invalid"
	| "recognizer-start-failed"
	| "recognizer-failed";

export interface SpeechInputStatus {
	supported: boolean;
	phase: SpeechInputPhase;
	modelId: string;
	errorCode?: SpeechInputErrorCode;
}

export type SpeechInputEvent =
	| { type: "status"; status: SpeechInputStatus }
	| { type: "partial"; sessionId: string; text: string }
	| { type: "final"; sessionId: string; text: string }
	| { type: "error"; sessionId?: string; code: SpeechInputErrorCode };

export interface DesktopSpeechInputApi {
	getStatus(): Promise<SpeechInputStatus>;
	start(): Promise<{ sessionId: string }>;
	pushAudio(sessionId: string, samples: Float32Array): void;
	stop(sessionId: string): Promise<void>;
	cancel(sessionId: string): Promise<void>;
	onEvent(handler: (event: SpeechInputEvent) => void): () => void;
}
