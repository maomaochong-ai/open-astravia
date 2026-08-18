import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	abort: vi.fn(async () => {}),
	run: vi.fn(async () => ({ skipped: false })),
	schedulerStop: vi.fn(),
	unlockRaws: vi.fn(async () => {}),
	createSessionFactory: vi.fn((_options: unknown) => ({ create: vi.fn() })),
}));

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("toad-scheduler", () => ({
	AsyncTask: class {},
	SimpleIntervalJob: class {},
	ToadScheduler: class {
		addSimpleIntervalJob(): void {}
		removeById(): void {}
		stop(): void {
			mocks.schedulerStop();
		}
	},
}));

vi.mock("../app-monitor/app-monitor-service.js", () => ({
	recordKnowledgeBaseProcessingResult: vi.fn(),
	recordKnowledgeBaseProcessingRound: vi.fn(),
	recordKnowledgeBaseProcessingUsage: vi.fn(),
	recordKnowledgeBaseSnapshot: vi.fn(),
}));

vi.mock("../agent-runtime/host-services.js", () => ({
	getOrCreateSharedModelRuntime: vi.fn(),
}));

vi.mock("../ipc/fs.js", () => ({
	KB_PROCESSING_CWD: "C:/knowledge/processing",
	KB_PROCESSING_SESSION_DIR: "C:/knowledge/processing/.vetta/sessions",
	readDesktopConfig: vi.fn(async () => ({ knowledgeBase: { enabled: false } })),
}));

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("./knowledge-round-controller.js", () => ({
	KnowledgeRoundController: class {
		abort = mocks.abort;
		isProcessing(): boolean {
			return false;
		}
		isRunning(): boolean {
			return false;
		}
		recordCurrentSnapshot(): Promise<void> {
			return Promise.resolve();
		}
		scheduleCurrentSnapshot(): void {}
		run(): Promise<{ skipped: boolean }> {
			return mocks.run();
		}
		runMaintenance<T>(fn: (root: string) => Promise<T>): Promise<T> {
			return fn("C:/knowledge");
		}
		retryFailed(): Promise<{ skipped: boolean }> {
			return Promise.resolve({ skipped: true });
		}
	},
}));

vi.mock("./processing-session-factory.js", () => ({
	createDesktopKnowledgeProcessingSessionFactory: mocks.createSessionFactory,
}));

vi.mock("./raws-lock.js", () => ({
	beginRound: vi.fn(async () => {}),
	endRound: vi.fn(async () => {}),
	unlockRaws: mocks.unlockRaws,
}));

import { runKnowledgeRound, shutdownKnowledgePoller } from "./poller.js";

const knowledgeFactoryOptions = mocks.createSessionFactory.mock.calls[0]?.[0];

describe("Knowledge Poller shutdown", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the shared model service for Knowledge processing", () => {
		expect(knowledgeFactoryOptions).toEqual({
			getModelRegistry: expect.any(Function),
		});
	});

	it("stops scheduling once, waits for the active round, and unlocks raws idempotently", async () => {
		let finishAbort!: () => void;
		mocks.abort.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishAbort = resolve;
				}),
		);

		const first = shutdownKnowledgePoller();
		const second = shutdownKnowledgePoller();

		expect(second).toBe(first);
		expect(mocks.schedulerStop).toHaveBeenCalledOnce();
		expect(mocks.abort).toHaveBeenCalledOnce();
		expect(mocks.unlockRaws).not.toHaveBeenCalled();

		finishAbort();
		await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
		expect(mocks.unlockRaws).toHaveBeenCalledOnce();
		expect(mocks.abort.mock.invocationCallOrder[0]).toBeLessThan(mocks.unlockRaws.mock.invocationCallOrder[0] ?? 0);
		await expect(runKnowledgeRound("provider/model")).resolves.toEqual({ skipped: true });
		expect(mocks.run).not.toHaveBeenCalled();
	});
});
