import type { ProgressInfo } from "builder-util-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateEngine, UpdateEngineCheckResult, UpdateEngineDownload } from "./updater-engine.js";
import { UpdaterService } from "./updater-service.js";

class FakeUpdateEngine implements UpdateEngine {
	checkResult: UpdateEngineCheckResult | null = null;
	installCalls = 0;
	cancelCalls = 0;
	private progressHandler: ((progress: ProgressInfo) => void) | null = null;
	private stagingHandler: (() => void) | null = null;
	private resolveDownload: ((paths: string[]) => void) | null = null;

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		return this.checkResult;
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload {
		this.progressHandler = onProgress;
		this.stagingHandler = onStaging ?? null;
		return {
			promise: new Promise<string[]>((resolve) => {
				this.resolveDownload = resolve;
			}),
			cancel: () => {
				this.cancelCalls += 1;
			},
		};
	}

	emitProgress(progress: ProgressInfo): void {
		this.progressHandler?.(progress);
	}

	emitStaging(): void {
		this.stagingHandler?.();
	}

	completeDownload(paths: string[]): void {
		this.resolveDownload?.(paths);
	}

	async quitAndInstall(): Promise<void> {
		this.installCalls += 1;
	}
}

const translate = (key: string): string => key;

function createUpToDateEngine(): FakeUpdateEngine {
	const engine = new FakeUpdateEngine();
	engine.checkResult = { hasUpdate: false, info: { version: "0.5.21" } };
	return engine;
}

function createResumeEvents(): {
	events: { onResume(listener: () => void): () => void };
	emit: () => void;
	listenerCount: () => number;
} {
	const listeners = new Set<() => void>();
	return {
		emit: () => {
			for (const listener of listeners) listener();
		},
		events: {
			onResume: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		listenerCount: () => listeners.size,
	};
}

function createAvailableEngine(): FakeUpdateEngine {
	const engine = new FakeUpdateEngine();
	engine.checkResult = {
		hasUpdate: true,
		info: {
			version: "0.6.0",
			releaseNote: "Release notes",
			assetFileName: "Vetta-0.6.0.exe",
			totalBytes: 1_000,
		},
	};
	return engine;
}

describe("UpdaterService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("maps an available electron-updater release to the existing state contract", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);

		await service.check();

		expect(service.getState()).toMatchObject({
			phase: "available",
			currentVersion: "0.5.21",
			latestVersion: "0.6.0",
			releaseNote: "Release notes",
			assetFileName: "Vetta-0.6.0.exe",
			totalBytes: 1_000,
		});
	});

	it("reports progress and marks the downloaded update ready", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);
		await service.check();

		const downloadPromise = service.startDownload();
		engine.emitProgress({
			bytesPerSecond: 100,
			delta: 500,
			percent: 50,
			total: 1_000,
			transferred: 500,
		});
		expect(service.getState()).toMatchObject({
			phase: "downloading",
			progress: 0.5,
			downloadedBytes: 500,
		});

		engine.completeDownload(["C:\\updates\\Vetta-0.6.0.exe"]);
		await downloadPromise;

		expect(service.getState()).toMatchObject({
			phase: "ready",
			progress: 1,
		});
		await service.install();
		expect(engine.installCalls).toBe(1);
	});

	it("cancels an active download without surfacing a download error", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);
		await service.check();
		void service.startDownload();

		service.cancel();

		expect(engine.cancelCalls).toBe(1);
		expect(service.getState()).toMatchObject({
			phase: "idle",
			error: undefined,
		});
	});

	it("cancels a stalled download and allows the user to retry", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			downloadStallTimeoutMs: 1_000,
		});
		await service.check();
		void service.startDownload();

		await vi.advanceTimersByTimeAsync(900);
		engine.emitProgress({
			bytesPerSecond: 100,
			delta: 100,
			percent: 10,
			total: 1_000,
			transferred: 100,
		});
		await vi.advanceTimersByTimeAsync(900);
		expect(engine.cancelCalls).toBe(0);

		await vi.advanceTimersByTimeAsync(100);
		expect(engine.cancelCalls).toBe(1);
		expect(service.getState()).toMatchObject({
			phase: "error",
			progress: undefined,
			error: "updater.errors.downloadFailed",
		});
	});

	it("does not treat Squirrel.Mac staging as a stalled download", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			downloadStallTimeoutMs: 1_000,
			stagingTimeoutMs: 10_000,
		});
		await service.check();
		const downloadPromise = service.startDownload();

		// 引擎把网络阶段压缩到 0～90%，暂存期间进度停在这里不再变化。
		engine.emitProgress({
			bytesPerSecond: 100,
			delta: 1_000,
			percent: 90,
			total: 1_000,
			transferred: 1_000,
		});
		engine.emitStaging();
		expect(service.getState()).toMatchObject({
			phase: "downloading",
			progress: 0.9,
			downloadedBytes: 1_000,
		});

		// 暂存期间没有任何进度事件，短停滞超时不得触发。
		await vi.advanceTimersByTimeAsync(5_000);
		expect(engine.cancelCalls).toBe(0);
		expect(service.getState().phase).toBe("downloading");

		engine.completeDownload(["/Applications/Vetta.app"]);
		await downloadPromise;
		expect(service.getState().phase).toBe("ready");
	});

	it("gives up when Squirrel.Mac never finishes staging", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			downloadStallTimeoutMs: 1_000,
			stagingTimeoutMs: 10_000,
		});
		await service.check();
		void service.startDownload();

		engine.emitStaging();
		await vi.advanceTimersByTimeAsync(10_000);

		expect(engine.cancelCalls).toBe(1);
		expect(service.getState()).toMatchObject({
			phase: "error",
			error: "updater.errors.downloadFailed",
		});
	});

	it("keeps a downloaded update ready when cancel is requested", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);
		await service.check();
		const downloadPromise = service.startDownload();
		engine.completeDownload(["C:\\updates\\Vetta-0.6.0.exe"]);
		await downloadPromise;

		service.cancel();

		expect(engine.cancelCalls).toBe(0);
		expect(service.getState().phase).toBe("ready");
	});

	it("keeps checking on a schedule while the app stays open", async () => {
		const engine = createUpToDateEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", true, translate, { periodicCheckIntervalMs: 60_000 });

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(checkSpy).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(checkSpy).toHaveBeenCalledTimes(3);

		service.dispose();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(checkSpy).toHaveBeenCalledTimes(3);
	});

	it("does not re-check while an update is already available or downloading", async () => {
		const engine = createAvailableEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			autoDownloadDelayMs: 10_000_000,
			periodicCheckIntervalMs: 60_000,
		});

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(service.getState().phase).toBe("available");

		await vi.advanceTimersByTimeAsync(180_000);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		service.dispose();
	});

	it("checks again after the machine wakes from sleep", async () => {
		const engine = createUpToDateEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const resume = createResumeEvents();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			periodicCheckIntervalMs: 600_000,
			backgroundCheckMinGapMs: 60_000,
			systemEvents: resume.events,
		});

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		// 距离上一次检查太近的唤醒（合盖再开、切换电源）不应重复请求更新源。
		await vi.advanceTimersByTimeAsync(30_000);
		resume.emit();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		resume.emit();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(2);

		// 唤醒补查后周期重新对齐，补查之后的一个完整间隔才再查一次。
		await vi.advanceTimersByTimeAsync(599_000);
		expect(checkSpy).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(checkSpy).toHaveBeenCalledTimes(3);

		service.dispose();
		expect(resume.listenerCount()).toBe(0);
	});

	it("syncs opportunistically when the user opens the settings menu", async () => {
		const engine = createUpToDateEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			backgroundCheckMinGapMs: 60_000,
			periodicCheckIntervalMs: 600_000,
		});

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		// 反复开合菜单不应反复请求更新源。
		await service.syncInBackground();
		await service.syncInBackground();
		expect(checkSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		await service.syncInBackground();
		expect(checkSpy).toHaveBeenCalledTimes(2);

		service.dispose();
	});

	it("does not sync in the background while a download is in flight", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			backgroundCheckMinGapMs: 0,
			periodicCheckIntervalMs: 0,
		});
		await service.check();
		void service.startDownload();
		expect(service.getState().phase).toBe("downloading");

		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		await service.syncInBackground();

		expect(checkSpy).not.toHaveBeenCalled();
		expect(service.getState().phase).toBe("downloading");
		service.cancel();
		service.dispose();
	});

	it("does not check update feeds in development mode", async () => {
		const engine = createAvailableEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", false, translate);

		await service.check();

		expect(checkSpy).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			phase: "error",
			error: "updater.errors.developmentUnsupported",
		});
	});
});
