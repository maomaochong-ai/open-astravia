import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
	KnowledgeProcessingPageWriter,
	KnowledgeProcessingSessionFactory,
	KnowledgeProcessingSessionRequest,
	KnowledgeProcessingUsage,
} from "@vetta/coding-agent/composition";
import * as knowledge from "@vetta/runtime-knowledge";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	KnowledgeRoundController,
	type KnowledgeRoundEffects,
	type KnowledgeRoundLogger,
} from "./knowledge-round-controller.js";

const NOW = "2026-07-31T00:00:00.000Z";
const MODEL_KEY = "provider/processing-model";

describe("KnowledgeRoundController", () => {
	const directories: string[] = [];

	afterEach(async () => {
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("runs real multi-batch knowledge operations and records successful side effects", async () => {
		const root = await temporaryDirectory("knowledge-round-success-");
		const pages = await createRawFixtures(root, 21);
		await knowledge.writeFailures(root, {
			version: 1,
			entries: {
				[pages[0].source_path]: {
					source_hash: pages[0].source_hash,
					source_path: pages[0].source_path,
					attempts: 2,
					first_failed_at: "2026-07-29T00:00:00.000Z",
					last_failed_at: "2026-07-30T00:00:00.000Z",
					quarantined: false,
				},
			},
		});
		const sessions = createSessionFactoryFixture(root, pages);
		const fixture = await createControllerFixture(root, sessions);

		await expect(fixture.controller.run(MODEL_KEY, 2, "medium")).resolves.toEqual({ skipped: false });

		await vi.waitFor(() => {
			expect(fixture.effects.processingResults).toEqual([{ filesProcessed: 21, filesFailed: 0 }]);
			expect(fixture.effects.snapshots).toEqual([{ kbCount: 1, totalSourceFiles: 21, wikiPageCount: 21 }]);
		});
		const [{ pages: writtenPages }, manifest, failures] = await Promise.all([
			knowledge.scanWikiPages(root),
			knowledge.readManifest(root),
			knowledge.readFailures(root),
		]);
		expect(writtenPages).toHaveLength(21);
		expect(manifest.pages).toHaveLength(21);
		expect(failures.entries).toEqual({});
		expect(sessions.createdRequests).toHaveLength(2);
		expect(sessions.writerReferences.size).toBe(1);
		expect(sessions.disposed).toBe(2);
		expect(sessions.aborted).toBe(0);
		expect(sessions.activeUsageSubscriptions).toBe(0);
		expect(fixture.effects.processingChanges).toEqual([true, false]);
		expect(fixture.effects.processingRounds).toBe(1);
		expect(fixture.effects.usages).toHaveLength(2);
		expect(fixture.effects.statusChanges).toBeGreaterThanOrEqual(2);
		expect(fixture.rawsLockEvents).toEqual([`begin:${root}`, `end:${root}`]);
		expect(await pathExists(fixture.roundTemporaryDirectory)).toBe(false);
		expect(fixture.controller.isRunning()).toBe(false);
		expect(fixture.controller.isProcessing()).toBe(false);
	});

	it("preserves partial writes but skips final reconciliation after a batch failure", async () => {
		const root = await temporaryDirectory("knowledge-round-failure-");
		const pages = await createRawFixtures(root, 21);
		const sessions = createSessionFactoryFixture(root, pages, { failBatchIndex: 1 });
		const fixture = await createControllerFixture(root, sessions);

		await expect(fixture.controller.run(MODEL_KEY, 1)).rejects.toThrow("provider failed for batch 1");

		const [{ pages: writtenPages }, failures] = await Promise.all([
			knowledge.scanWikiPages(root),
			knowledge.readFailures(root),
		]);
		expect(writtenPages).toHaveLength(20);
		expect(failures.entries).toEqual({});
		expect(sessions.createdRequests).toHaveLength(2);
		expect(sessions.writerReferences.size).toBe(1);
		expect(sessions.disposed).toBe(2);
		expect(sessions.activeUsageSubscriptions).toBe(0);
		expect(fixture.effects.processingChanges).toEqual([true, false]);
		expect(fixture.effects.processingRounds).toBe(1);
		expect(fixture.effects.usages).toHaveLength(1);
		expect(fixture.effects.processingResults).toEqual([]);
		expect(fixture.effects.snapshots).toEqual([]);
		expect(fixture.rawsLockEvents).toEqual([`begin:${root}`, `end:${root}`]);
		expect(await pathExists(fixture.roundTemporaryDirectory)).toBe(false);
		expect(fixture.controller.isRunning()).toBe(false);
		expect(fixture.controller.isProcessing()).toBe(false);
	});

	it("aborts the active session, skips queued batches, and completes cleanup without failure accounting", async () => {
		const root = await temporaryDirectory("knowledge-round-abort-");
		const pages = await createRawFixtures(root, 41);
		const sessions = createSessionFactoryFixture(root, pages, { blockedBatchCount: 2 });
		const fixture = await createControllerFixture(root, sessions);

		const runPromise = fixture.controller.run(MODEL_KEY, 2);
		await sessions.firstRunStarted;
		await fixture.controller.abort();
		await expect(runPromise).resolves.toEqual({ skipped: false });

		await vi.waitFor(() => {
			expect(fixture.effects.snapshots).toEqual([{ kbCount: 1, totalSourceFiles: 41, wikiPageCount: 0 }]);
		});
		const [{ pages: writtenPages }, failures] = await Promise.all([
			knowledge.scanWikiPages(root),
			knowledge.readFailures(root),
		]);
		expect(writtenPages).toEqual([]);
		expect(failures.entries).toEqual({});
		expect(sessions.createdRequests).toHaveLength(2);
		expect(sessions.aborted).toBe(2);
		expect(sessions.disposed).toBe(2);
		expect(sessions.activeUsageSubscriptions).toBe(0);
		expect(fixture.effects.processingChanges).toEqual([true, false]);
		expect(fixture.effects.processingResults).toEqual([]);
		expect(fixture.effects.usages).toEqual([]);
		expect(fixture.effects.statusChanges).toBe(1);
		expect(fixture.rawsLockEvents).toEqual([`begin:${root}`, `end:${root}`]);
		expect(await pathExists(fixture.roundTemporaryDirectory)).toBe(false);
		expect(fixture.controller.isRunning()).toBe(false);
		expect(fixture.controller.isProcessing()).toBe(false);
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

interface SessionFactoryFixtureOptions {
	readonly failBatchIndex?: number;
	readonly blockedBatchCount?: number;
}

interface SessionFactoryFixture {
	readonly factory: KnowledgeProcessingSessionFactory;
	readonly createdRequests: KnowledgeProcessingSessionRequest[];
	readonly writerReferences: Set<KnowledgeProcessingPageWriter>;
	readonly firstRunStarted: Promise<void>;
	disposed: number;
	aborted: number;
	activeUsageSubscriptions: number;
}

function createSessionFactoryFixture(
	root: string,
	pages: readonly knowledge.WritePageRequest[],
	options: SessionFactoryFixtureOptions = {},
): SessionFactoryFixture {
	const firstRunStarted = deferred();
	const blockedRun = deferred();
	let blockedRunsStarted = 0;
	const fixture: SessionFactoryFixture = {
		factory: {
			async create(request) {
				const batchIndex = fixture.createdRequests.length;
				fixture.createdRequests.push(request);
				fixture.writerReferences.add(request.writer);
				const usageListeners = new Set<(usage: KnowledgeProcessingUsage) => void>();
				return {
					async run() {
						if (batchIndex < (options.blockedBatchCount ?? 0)) {
							blockedRunsStarted += 1;
							if (blockedRunsStarted === options.blockedBatchCount) firstRunStarted.resolve();
							await blockedRun.promise;
							return;
						}
						if (options.failBatchIndex === batchIndex) {
							throw new Error(`provider failed for batch ${batchIndex}`);
						}
						const batchPages = pages.filter((page) =>
							request.todoItems.some((todo) => todo.includes(join(knowledge.rawsDir(root), page.source_path))),
						);
						for (const page of batchPages) {
							await request.writer.write(page, NOW);
						}
						for (const listener of usageListeners) listener(USAGE);
					},
					async abort() {
						fixture.aborted += 1;
						blockedRun.resolve();
					},
					subscribeUsage(listener) {
						usageListeners.add(listener);
						fixture.activeUsageSubscriptions += 1;
						return () => {
							if (!usageListeners.delete(listener)) return;
							fixture.activeUsageSubscriptions -= 1;
						};
					},
					async dispose() {
						fixture.disposed += 1;
					},
				};
			},
		},
		createdRequests: [],
		writerReferences: new Set(),
		firstRunStarted: firstRunStarted.promise,
		disposed: 0,
		aborted: 0,
		activeUsageSubscriptions: 0,
	};
	return fixture;
}

interface EffectsFixture {
	readonly effects: KnowledgeRoundEffects;
	readonly processingChanges: boolean[];
	readonly usages: KnowledgeProcessingUsage[];
	readonly processingResults: Array<{ readonly filesProcessed: number; readonly filesFailed: number }>;
	readonly snapshots: Array<{
		readonly kbCount: number;
		readonly totalSourceFiles: number;
		readonly wikiPageCount: number;
	}>;
	processingRounds: number;
	statusChanges: number;
}

interface ControllerFixture {
	readonly controller: KnowledgeRoundController;
	readonly effects: EffectsFixture;
	readonly rawsLockEvents: string[];
	readonly roundTemporaryDirectory: string;
}

async function createControllerFixture(root: string, sessions: SessionFactoryFixture): Promise<ControllerFixture> {
	const effects = createEffectsFixture();
	const rawsLockEvents: string[] = [];
	const roundTemporaryDirectory = join(root, ".round-tmp");
	const logger: KnowledgeRoundLogger = {
		info() {},
		warn() {},
	};
	return {
		controller: new KnowledgeRoundController({
			sessionFactory: sessions.factory,
			getKnowledgeRoot: () => root,
			sessionCwd: join(root, "processing-cwd"),
			sessionDir: join(root, "processing-sessions"),
			effects: effects.effects,
			rawsLock: {
				async begin(lockRoot) {
					rawsLockEvents.push(`begin:${lockRoot}`);
				},
				async end(lockRoot) {
					rawsLockEvents.push(`end:${lockRoot}`);
				},
			},
			temporaryDirectory: {
				async create() {
					await mkdir(roundTemporaryDirectory, { recursive: true });
					return roundTemporaryDirectory;
				},
				remove: (path) => rm(path, { recursive: true, force: true }),
			},
			logger,
			now: () => NOW,
		}),
		effects,
		rawsLockEvents,
		roundTemporaryDirectory,
	};
}

function createEffectsFixture(): EffectsFixture {
	const fixture: EffectsFixture = {
		effects: {
			processingChanged(processing) {
				fixture.processingChanges.push(processing);
			},
			statusesChanged() {
				fixture.statusChanges += 1;
			},
			recordProcessingRound() {
				fixture.processingRounds += 1;
			},
			recordProcessingUsage(usage) {
				fixture.usages.push(usage);
			},
			recordProcessingResult(filesProcessed, filesFailed) {
				fixture.processingResults.push({ filesProcessed, filesFailed });
			},
			recordSnapshot(snapshot) {
				fixture.snapshots.push(snapshot);
			},
			reportDamagedPages() {},
		},
		processingChanges: [],
		usages: [],
		processingResults: [],
		snapshots: [],
		processingRounds: 0,
		statusChanges: 0,
	};
	return fixture;
}

async function createRawFixtures(root: string, count: number): Promise<knowledge.WritePageRequest[]> {
	const pages: knowledge.WritePageRequest[] = [];
	for (let index = 0; index < count; index += 1) {
		const sourcePath = `source/file-${String(index).padStart(2, "0")}.md`;
		const content = `content-${index}`;
		const rawPath = join(knowledge.rawsDir(root), sourcePath);
		await mkdir(dirname(rawPath), { recursive: true });
		await writeFile(rawPath, content, "utf8");
		pages.push({
			path: "topics/shared.md",
			source: "source",
			source_path: sourcePath,
			source_hash: knowledge.hashContent(content),
			tags: ["shared"],
			title: `Page ${index}`,
			summary: `Summary ${index}`,
			body: `# Page ${index}\n\n${content}`,
		});
	}
	return pages;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => {
		resolve = () => settle();
	});
	return { promise, resolve };
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

const USAGE: KnowledgeProcessingUsage = {
	inputTokens: 10,
	outputTokens: 20,
	cacheReadTokens: 3,
	cacheWriteTokens: 4,
	costTotal: 0.25,
};
