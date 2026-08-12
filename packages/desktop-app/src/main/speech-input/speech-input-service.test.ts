import { describe, expect, it, vi } from "vitest";
import type { SpeechInputEvent, SpeechInputStatus } from "../../preload/api-types/speech-input.js";
import type { SpeechHostCommand, SpeechHostEvent } from "./protocol.js";
import { SpeechInputService, type SpeechModelAccess } from "./speech-input-service.js";

vi.mock("electron", () => ({ app: { isPackaged: false }, utilityProcess: { fork: vi.fn() } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const READY_STATUS: SpeechInputStatus = {
	supported: true,
	phase: "ready",
	modelId: "test-model",
};

class FakeSpeechHostChild {
	readonly commands: SpeechHostCommand[] = [];
	readonly kill = vi.fn(() => true);
	readonly stdout = null;
	readonly stderr = null;
	private readonly messageListeners: Array<(message: unknown) => void> = [];
	private readonly exitListeners: Array<(code: number) => void> = [];
	private readonly spawnListeners: Array<() => void> = [];

	on(
		event: "message" | "exit" | "spawn",
		listener: ((message: unknown) => void) | ((code: number) => void) | (() => void),
	): void {
		if (event === "message") this.messageListeners.push(listener as (message: unknown) => void);
		else if (event === "exit") this.exitListeners.push(listener as (code: number) => void);
		else {
			this.spawnListeners.push(listener as () => void);
			queueMicrotask(() => {
				for (const spawnListener of this.spawnListeners) spawnListener();
				this.emit({ type: "ready" });
			});
		}
	}

	postMessage(command: SpeechHostCommand): void {
		this.commands.push(command);
		if (command.type === "initialize") {
			queueMicrotask(() => {
				this.emit({ type: "initializing" });
				this.emit({ type: "initialized" });
			});
		}
		if (command.type === "start") {
			queueMicrotask(() => this.emit({ type: "started", sessionId: command.sessionId }));
		}
		if (command.type === "stop") {
			queueMicrotask(() => {
				this.emit({ type: "final", sessionId: command.sessionId, text: "完成" });
				this.emit({ type: "stopped", sessionId: command.sessionId });
			});
		}
	}

	emit(message: SpeechHostEvent): void {
		for (const listener of this.messageListeners) listener(message);
	}
}

describe("SpeechInputService", () => {
	it("coordinates initialization, one session, audio, final text, and stop", async () => {
		const child = new FakeSpeechHostChild();
		const events: SpeechInputEvent[] = [];
		const modelManager: SpeechModelAccess = {
			supported: true,
			modelDirectory: "C:/cache/model",
			getStatus: vi.fn(async () => READY_STATUS),
		};
		const service = new SpeechInputService({
			sendEvent: (event) => events.push(event),
			forkChild: () => child,
			modelManager,
		});

		const { sessionId } = await service.start();
		service.pushAudio(sessionId, new Float32Array([0.1, -0.1]));
		await service.stop(sessionId);

		expect(child.commands.map((command) => command.type)).toEqual(["initialize", "start", "audio", "stop"]);
		expect(events).toContainEqual({ type: "final", sessionId, text: "完成" });
		expect(events.at(-1)).toMatchObject({ type: "status", status: { phase: "ready" } });
		service.dispose();
		expect(child.kill).toHaveBeenCalledOnce();
	});
});
