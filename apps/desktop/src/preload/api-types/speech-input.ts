export type SpeechInputPhase = "unsupported" | "unavailable" | "ready" | "loading" | "listening" | "stopping" | "error";

export type SpeechInputErrorCode =
	| "unsupported-platform"
	| "bundled-model-missing"
	| "bundled-model-invalid"
	| "recognizer-start-failed"
	| "recognizer-failed"
	| "microphone-denied"
	/** 麦克风已打开但一直是静音：多为系统权限被拒、选错输入设备或设备被占用。 */
	| "microphone-silent";

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
