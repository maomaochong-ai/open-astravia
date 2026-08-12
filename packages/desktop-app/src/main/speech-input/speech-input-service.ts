import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { utilityProcess } from "electron";
import type { SpeechInputEvent, SpeechInputStatus } from "../../preload/api-types/speech-input.js";
import { getAppLogger } from "../logger.js";
import { resolveSpeechModelPaths, WINDOWS_ZIPFORMER_MODEL } from "./model-catalog.js";
import { SpeechModelManager } from "./model-manager.js";
import { isSpeechHostEvent, type SpeechHostCommand, type SpeechHostEvent } from "./protocol.js";

const log = getAppLogger("speech-input");
const HOST_START_TIMEOUT_MS = 15_000;

interface SpeechHostChild {
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "exit", listener: (code: number) => void): unknown;
	postMessage(message: SpeechHostCommand): void;
	kill(): boolean;
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: Error) => void;
}

function createDeferred(): Deferred {
	let resolve = (): void => undefined;
	let reject = (_error: Error): void => undefined;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

export interface SpeechInputServiceOptions {
	sendEvent: (event: SpeechInputEvent) => void;
	forkChild?: () => SpeechHostChild;
	modelManager?: SpeechModelAccess;
}

export interface SpeechModelAccess {
	readonly supported: boolean;
	readonly modelDirectory: string;
	getStatus(): Promise<SpeechInputStatus>;
	download(): Promise<SpeechInputStatus>;
	cancelDownload(): void;
}

export class SpeechInputService {
	private readonly sendEvent: (event: SpeechInputEvent) => void;
	private readonly forkChild: () => SpeechHostChild;
	private readonly modelManager: SpeechModelAccess;
	private child: SpeechHostChild | null = null;
	private initialized = false;
	private initializeWaiter: Deferred | null = null;
	private sessionWaiter: Deferred | null = null;
	private activeSessionId: string | null = null;
	private transientStatus: SpeechInputStatus | null = null;

	constructor(options: SpeechInputServiceOptions) {
		this.sendEvent = options.sendEvent;
		this.forkChild =
			options.forkChild ??
			(() =>
				utilityProcess.fork(fileURLToPath(new URL("./speech-input-host.js", import.meta.url)), [], {
					serviceName: "vetta-speech-input-host",
				}));
		this.modelManager =
			options.modelManager ??
			new SpeechModelManager({
				onStatus: (status) => this.publishStatus(status),
			});
	}

	async getStatus(): Promise<SpeechInputStatus> {
		if (this.transientStatus && ["loading", "listening", "stopping"].includes(this.transientStatus.phase))
			return this.transientStatus;
		return this.modelManager.getStatus();
	}

	downloadModel(): Promise<SpeechInputStatus> {
		return this.modelManager.download();
	}

	cancelDownload(): void {
		this.modelManager.cancelDownload();
	}

	async start(): Promise<{ sessionId: string }> {
		if (this.activeSessionId) return { sessionId: this.activeSessionId };
		const status = await this.modelManager.getStatus();
		if (status.phase !== "ready") throw new Error("Speech recognition model is not ready");

		this.publishTransient("loading");
		try {
			await this.ensureInitialized();
			const sessionId = randomUUID();
			this.activeSessionId = sessionId;
			this.sessionWaiter = createDeferred();
			this.requireChild().postMessage({ type: "start", sessionId });
			await this.sessionWaiter.promise;
			this.publishTransient("listening");
			return { sessionId };
		} catch (error) {
			this.activeSessionId = null;
			this.publishTransient("error", "recognizer-start-failed");
			throw error;
		}
	}

	pushAudio(sessionId: string, samples: Float32Array): void {
		if (sessionId !== this.activeSessionId || samples.length === 0) return;
		this.child?.postMessage({ type: "audio", sessionId, samples });
	}

	async stop(sessionId: string): Promise<void> {
		if (sessionId !== this.activeSessionId) return;
		this.publishTransient("stopping");
		this.sessionWaiter = createDeferred();
		this.requireChild().postMessage({ type: "stop", sessionId });
		await this.sessionWaiter.promise;
	}

	async cancel(sessionId: string): Promise<void> {
		if (sessionId !== this.activeSessionId) return;
		this.sessionWaiter = createDeferred();
		this.requireChild().postMessage({ type: "cancel", sessionId });
		await this.sessionWaiter.promise;
	}

	dispose(): void {
		this.modelManager.cancelDownload();
		this.rejectWaiters(new Error("Speech input service disposed"));
		this.activeSessionId = null;
		this.initialized = false;
		this.child?.kill();
		this.child = null;
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		if (this.initializeWaiter) return this.initializeWaiter.promise;

		const child = this.forkChild();
		this.child = child;
		child.on("message", (message) => this.handleHostMessage(message));
		child.on("exit", (code) => this.handleHostExit(code));
		const waiter = createDeferred();
		this.initializeWaiter = waiter;
		child.postMessage({
			type: "initialize",
			model: resolveSpeechModelPaths(this.modelManager.modelDirectory),
			sampleRate: WINDOWS_ZIPFORMER_MODEL.sampleRate,
		});

		const timeout = setTimeout(() => {
			if (this.initializeWaiter !== waiter) return;
			waiter.reject(new Error("Speech recognition host initialization timed out"));
			this.initializeWaiter = null;
			this.child?.kill();
			this.child = null;
		}, HOST_START_TIMEOUT_MS);
		try {
			await waiter.promise;
		} finally {
			clearTimeout(timeout);
		}
	}

	private handleHostMessage(message: unknown): void {
		if (!isSpeechHostEvent(message)) return;
		switch (message.type) {
			case "initialized":
				this.initialized = true;
				this.initializeWaiter?.resolve();
				this.initializeWaiter = null;
				break;
			case "started":
				if (message.sessionId === this.activeSessionId) this.resolveSessionWaiter();
				break;
			case "partial":
			case "final":
				if (message.sessionId === this.activeSessionId) this.sendEvent(message);
				break;
			case "stopped":
				if (message.sessionId !== this.activeSessionId) return;
				this.activeSessionId = null;
				this.resolveSessionWaiter();
				this.publishTransient("ready");
				break;
			case "error":
				this.handleHostError(message);
				break;
		}
	}

	private handleHostError(message: Extract<SpeechHostEvent, { type: "error" }>): void {
		log.error("speech recognition host failed", { code: message.code });
		this.sendEvent(message);
		this.activeSessionId = null;
		this.rejectWaiters(new Error(message.code));
		this.publishTransient("error", message.code);
	}

	private handleHostExit(code: number): void {
		this.child = null;
		this.initialized = false;
		if (!this.initializeWaiter && !this.activeSessionId) return;
		log.error("speech recognition host exited unexpectedly", { code });
		this.activeSessionId = null;
		this.rejectWaiters(new Error("Speech recognition host exited"));
		this.sendEvent({ type: "error", code: "recognizer-failed" });
		this.publishTransient("error", "recognizer-failed");
	}

	private publishTransient(phase: SpeechInputStatus["phase"], errorCode?: SpeechInputStatus["errorCode"]): void {
		this.publishStatus({
			supported: this.modelManager.supported,
			phase,
			modelId: WINDOWS_ZIPFORMER_MODEL.id,
			downloadedBytes: phase === "ready" ? WINDOWS_ZIPFORMER_MODEL.totalBytes : 0,
			totalBytes: WINDOWS_ZIPFORMER_MODEL.totalBytes,
			...(errorCode ? { errorCode } : {}),
		});
	}

	private publishStatus(status: SpeechInputStatus): void {
		this.transientStatus = status;
		this.sendEvent({ type: "status", status });
	}

	private requireChild(): SpeechHostChild {
		if (!this.child) throw new Error("Speech recognition host is unavailable");
		return this.child;
	}

	private resolveSessionWaiter(): void {
		this.sessionWaiter?.resolve();
		this.sessionWaiter = null;
	}

	private rejectWaiters(error: Error): void {
		this.initializeWaiter?.reject(error);
		this.sessionWaiter?.reject(error);
		this.initializeWaiter = null;
		this.sessionWaiter = null;
	}
}
