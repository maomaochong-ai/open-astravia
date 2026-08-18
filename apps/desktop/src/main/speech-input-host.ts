import type { SpeechHostCommand, SpeechHostEvent } from "./speech-input/protocol.js";
import { SherpaStreamingRecognizer } from "./speech-input/sherpa-adapter.js";

const port = process.parentPort;
if (!port) {
	console.error("[speech-input-host] process.parentPort unavailable");
	process.exit(1);
}

let recognizer: SherpaStreamingRecognizer | null = null;
let activeSessionId: string | null = null;

function post(message: SpeechHostEvent): void {
	port.postMessage(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function emitUpdate(sessionId: string, update: { partial?: string; final?: string }): void {
	if (update.partial) post({ type: "partial", sessionId, text: update.partial });
	if (update.final) post({ type: "final", sessionId, text: update.final });
}

function handleCommand(message: unknown): void {
	if (!isRecord(message) || typeof message.type !== "string") return;
	try {
		switch (message.type) {
			case "initialize": {
				const command = message as SpeechHostCommand & { type: "initialize" };
				post({ type: "initializing" });
				recognizer = new SherpaStreamingRecognizer(command.model, command.sampleRate);
				post({ type: "initialized" });
				break;
			}
			case "start": {
				if (!recognizer || typeof message.sessionId !== "string") return;
				activeSessionId = message.sessionId;
				recognizer.start();
				post({ type: "started", sessionId: activeSessionId });
				break;
			}
			case "audio": {
				if (
					!recognizer ||
					typeof message.sessionId !== "string" ||
					message.sessionId !== activeSessionId ||
					!(message.samples instanceof Float32Array)
				)
					return;
				emitUpdate(activeSessionId, recognizer.accept(message.samples));
				break;
			}
			case "stop": {
				if (!recognizer || message.sessionId !== activeSessionId || !activeSessionId) return;
				emitUpdate(activeSessionId, recognizer.stop());
				post({ type: "stopped", sessionId: activeSessionId });
				activeSessionId = null;
				break;
			}
			case "cancel": {
				if (!recognizer || message.sessionId !== activeSessionId || !activeSessionId) return;
				recognizer.cancel();
				post({ type: "stopped", sessionId: activeSessionId });
				activeSessionId = null;
				break;
			}
		}
	} catch (error) {
		console.error(
			"[speech-input-host] command failed",
			error instanceof Error ? (error.stack ?? error.message) : String(error),
		);
		post({
			type: "error",
			...(activeSessionId ? { sessionId: activeSessionId } : {}),
			code: recognizer ? "recognizer-failed" : "recognizer-start-failed",
		});
		activeSessionId = null;
	}
}

port.on("message", (event) => handleCommand(event.data));
setImmediate(() => post({ type: "ready" }));
