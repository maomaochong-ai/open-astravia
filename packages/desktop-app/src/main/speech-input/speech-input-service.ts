import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, utilityProcess } from "electron";
import type { SpeechInputEvent, SpeechInputStatus } from "../../preload/api-types/speech-input.js";
import { getAppLogger } from "../logger.js";
import { resolveSpeechModelPaths, WINDOWS_ZIPFORMER_MODEL } from "./model-catalog.js";
import { SpeechModelManager } from "./model-manager.js";
import { isSpeechHostEvent, type SpeechHostCommand, type SpeechHostEvent } from "./protocol.js";

const log = getAppLogger("speech-input");
const HOST_SPAWN_TIMEOUT_MS = 10_000;
const HOST_INITIALIZE_TIMEOUT_MS = 60_000;

interface SpeechHostChild {
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "exit", listener: (code: number) => void): unknown;
	on(event: "spawn", listener: () => void): unknown;
	readonly stderr?: NodeJS.ReadableStream | null;
	readonly stdout?: NodeJS.ReadableStream | null;
	postMessage(message: SpeechHostCommand): void;
	kill(): boolean;
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: Error) => void;
}

interface SpeechHostDiagnostic {
	phase: "forking" | "spawned" | "ready" | "initializing";
	stdout: string;
	stderr: string;
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
}

export class SpeechInputService {
	private readonly sendEvent: (event: SpeechInputEvent) => void;
	private readonly forkChild: () => SpeechHostChild;
	private readonly modelManager: SpeechModelAccess;
	private child: SpeechHostChild | null = null;
	private initialized = false;
	private initializeWaiter: Deferred | null = null;
	private initializeStartedAt = 0;
	private hostDiagnostic: SpeechHostDiagnostic | null = null;
	private sessionWaiter: Deferred | null = null;
	private activeSessionId: string | null = null;
	private transientStatus: SpeechInputStatus | null = null;

	constructor(options: SpeechInputServiceOptions) {
		this.sendEvent = options.sendEvent;
		this.forkChild =
			options.forkChild ??
			(() =>
				utilityProcess.fork(
					fileURLToPath(new URL(/* @vite-ignore */ "./speech-input-host.js", import.meta.url)),
					[],
					{
						serviceName: "vetta-speech-input-host",
						stdio: ["ignore", "pipe", "pipe"],
					},
				));
		this.modelManager =
			options.modelManager ??
			new SpeechModelManager({
				modelRoot: app.isPackaged
					? join(process.resourcesPath, "speech-models")
					: join(process.cwd(), "resources", "speech-models"),
			});
	}

	async getStatus(): Promise<SpeechInputStatus> {
		if (this.transientStatus && ["loading", "listening", "stopping"].includes(this.transientStatus.phase))
			return this.transientStatus;
		return this.modelManager.getStatus();
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
		this.initializeStartedAt = Date.now();
		this.hostDiagnostic = { phase: "forking", stdout: "", stderr: "" };
		this.captureHostOutput(child, "stdout");
		this.captureHostOutput(child, "stderr");
		child.on("spawn", () => {
			if (this.hostDiagnostic) this.hostDiagnostic.phase = "spawned";
		});
		child.on("message", (message) => this.handleHostMessage(message));
		child.on("exit", (code) => this.handleHostExit(code));
		const waiter = createDeferred();
		this.initializeWaiter = waiter;

		const timeout = setTimeout(() => {
			if (this.initializeWaiter !== waiter) return;
			const diagnostic = this.hostDiagnostic;
			log.error("speech recognition host initialization timed out", {
				durationMs: Date.now() - this.initializeStartedAt,
				phase: diagnostic?.phase,
				stdout: diagnostic?.stdout,
				stderr: diagnostic?.stderr,
			});
			waiter.reject(
				new Error(`Speech recognition host initialization timed out (phase=${diagnostic?.phase ?? "unknown"})`),
			);
			this.initializeWaiter = null;
			this.child?.kill();
			this.child = null;
		}, HOST_SPAWN_TIMEOUT_MS + HOST_INITIALIZE_TIMEOUT_MS);
		try {
			await waiter.promise;
		} finally {
			clearTimeout(timeout);
		}
	}

	private handleHostMessage(message: unknown): void {
		if (!isSpeechHostEvent(message)) return;
		switch (message.type) {
			case "ready":
				if (this.hostDiagnostic) this.hostDiagnostic.phase = "ready";
				this.requireChild().postMessage({
					type: "initialize",
					model: resolveSpeechModelPaths(this.modelManager.modelDirectory),
					sampleRate: WINDOWS_ZIPFORMER_MODEL.sampleRate,
				});
				break;
			case "initializing":
				if (this.hostDiagnostic) this.hostDiagnostic.phase = "initializing";
				break;
			case "initialized":
				this.initialized = true;
				log.info("speech recognition host initialized", {
					durationMs: Date.now() - this.initializeStartedAt,
				});
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
		log.error("speech recognition host failed", {
			code: message.code,
			phase: this.hostDiagnostic?.phase,
			stdout: this.hostDiagnostic?.stdout,
			stderr: this.hostDiagnostic?.stderr,
		});
		this.sendEvent(message);
		this.activeSessionId = null;
		this.rejectWaiters(new Error(message.code));
		this.publishTransient("error", message.code);
	}

	private handleHostExit(code: number): void {
		this.child = null;
		this.initialized = false;
		if (!this.initializeWaiter && !this.activeSessionId) return;
		log.error("speech recognition host exited unexpectedly", {
			code,
			phase: this.hostDiagnostic?.phase,
			stdout: this.hostDiagnostic?.stdout,
			stderr: this.hostDiagnostic?.stderr,
		});
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

	private captureHostOutput(child: SpeechHostChild, stream: "stdout" | "stderr"): void {
		child[stream]?.on("data", (chunk: Buffer | string) => {
			const diagnostic = this.hostDiagnostic;
			if (!diagnostic) return;
			diagnostic[stream] = `${diagnostic[stream]}${chunk.toString()}`.slice(-8_192);
		});
	}
}
