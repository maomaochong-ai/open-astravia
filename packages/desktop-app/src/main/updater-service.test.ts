import type { ProgressInfo } from "builder-util-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateEngine, UpdateEngineCheckResult, UpdateEngineDownload } from "./updater-engine.js";
import { UpdaterService } from "./updater-service.js";

class FakeUpdateEngine implements UpdateEngine {
	checkResult: UpdateEngineCheckResult | null = null;
	installCalls = 0;
	cancelCalls = 0;
	private progressHandler: ((progress: ProgressInfo) => void) | null = null;
	private resolveDownload: ((paths: string[]) => void) | null = null;

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		return this.checkResult;
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void): UpdateEngineDownload {
		this.progressHandler = onProgress;
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

	completeDownload(paths: string[]): void {
		this.resolveDownload?.(paths);
	}

	quitAndInstall(): void {
		this.installCalls += 1;
	}
}

const translate = (key: string): string => key;

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
