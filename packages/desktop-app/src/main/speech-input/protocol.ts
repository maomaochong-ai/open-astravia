import type { SpeechInputErrorCode } from "../../preload/api-types/speech-input.js";
import type { SpeechModelPaths } from "./model-catalog.js";

export type SpeechHostCommand =
	| { type: "initialize"; model: SpeechModelPaths; sampleRate: number }
	| { type: "start"; sessionId: string }
	| { type: "audio"; sessionId: string; samples: Float32Array }
	| { type: "stop"; sessionId: string }
	| { type: "cancel"; sessionId: string };

export type SpeechHostEvent =
	| { type: "ready" }
	| { type: "initializing" }
	| { type: "initialized" }
	| { type: "started"; sessionId: string }
	| { type: "partial"; sessionId: string; text: string }
	| { type: "final"; sessionId: string; text: string }
	| { type: "stopped"; sessionId: string }
	| { type: "error"; sessionId?: string; code: SpeechInputErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const ERROR_CODES = new Set([
	"unsupported-platform",
	"bundled-model-missing",
	"bundled-model-invalid",
	"recognizer-start-failed",
	"recognizer-failed",
]);

export function isSpeechHostEvent(value: unknown): value is SpeechHostEvent {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	switch (value.type) {
		case "ready":
		case "initializing":
		case "initialized":
			return true;
		case "started":
		case "stopped":
			return typeof value.sessionId === "string";
		case "partial":
		case "final":
			return typeof value.sessionId === "string" && typeof value.text === "string";
		case "error":
			return (
				(value.sessionId === undefined || typeof value.sessionId === "string") &&
				typeof value.code === "string" &&
				ERROR_CODES.has(value.code)
			);
		default:
			return false;
	}
}
