import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
	KnowledgeProcessingSession,
	KnowledgeProcessingSessionFactory,
	KnowledgeProcessingUsage,
} from "@vetta/coding-agent/composition";
import { createLimiter } from "@vetta/coding-agent/concurrency";
import * as knowledge from "@vetta/runtime-knowledge";

const KB_MAX_FILES_PER_BATCH = 20;
const KB_MAX_BYTES_PER_BATCH = 8 * 1024 * 1024;

export interface KnowledgeRoundLogger {
	info(message: string): void;
	warn(message: string): void;
}

export interface KnowledgeRoundEffects {
	processingChanged(processing: boolean): void;
	statusesChanged(): void;
	recordProcessingRound(): void;
	recordProcessingUsage(usage: KnowledgeProcessingUsage): void;
	recordProcessingResult(filesProcessed: number, filesFailed: number): void;
	recordSnapshot(snapshot: {
		readonly kbCount: number;
		readonly totalSourceFiles: number;
		readonly wikiPageCount: number;
	}): void;
	reportDamagedPages(result: knowledge.RebuildResult): void;
}

export interface KnowledgeRoundRawsLock {
	begin(root: string): Promise<void>;
	end(root: string): Promise<void>;
}

export interface KnowledgeRoundTemporaryDirectory {
	create(): Promise<string>;
	remove(path: string): Promise<void>;
}

export interface KnowledgeRoundControllerOptions {
	readonly sessionFactory: KnowledgeProcessingSessionFactory;
	readonly getKnowledgeRoot: () => string;
	readonly sessionCwd: string;
	readonly sessionDir: string;
	readonly effects: KnowledgeRoundEffects;
	readonly rawsLock: KnowledgeRoundRawsLock;
	readonly temporaryDirectory: KnowledgeRoundTemporaryDirectory;
	readonly logger: KnowledgeRoundLogger;
	readonly now?: () => string;
}

export interface KnowledgeRoundResult {
	readonly skipped: boolean;
	readonly reason?: "no-model";
}

interface RoundToken {
	aborted: boolean;
	sessions: Set<KnowledgeProcessingSession>;
}

/**
 * 单个 Desktop Knowledge 产品实例的轮级状态机。
 *
 * Knowledge 的 diff、批次、Writer、缓存和失败隔离继续使用真实实现；这里只组合
 * Session Port 与 Desktop 副作用，避免 Poller 调度壳持有 Agent/Runtime 细节。
 */
export class KnowledgeRoundController {
	private readonly now: () => string;
	private processing = false;
	private running = false;
	private currentRound: RoundToken | undefined;
	private roundDone: Promise<void> | undefined;
	private cacheRebuildRunning = false;
	private cacheRebuildPending = false;
	private snapshotRunning = false;
	private snapshotPending = false;

	constructor(private readonly options: KnowledgeRoundControllerOptions) {
		this.now = options.now ?? (() => new Date().toISOString());
	}

	isProcessing(): boolean {
		return this.processing;
	}

	isRunning(): boolean {
		return this.running;
	}

	async abort(): Promise<void> {
		const round = this.currentRound;
		if (!round) return;
		round.aborted = true;
		this.options.logger.info("aborting in-flight knowledge round");
		for (const session of round.sessions) {
			try {
				await session.abort();
			} catch (error) {
				this.options.logger.warn(`abort kb session failed: ${errorMessage(error)}`);
			}
		}
		await this.roundDone?.catch(() => {});
	}

	async run(modelKey?: string, agentConcurrency = 3, reasoningLevel?: string): Promise<KnowledgeRoundResult> {
		if (!modelKey || modelKey.indexOf("/") <= 0) {
			this.options.logger.info("no processing model configured, skipping round");
			return { skipped: true, reason: "no-model" };
		}
		if (this.running) {
			this.options.logger.info("previous round still running, skipping this tick");
			return { skipped: true };
		}
		this.running = true;
		const round: RoundToken = { aborted: false, sessions: new Set() };
		this.currentRound = round;
		let markRoundDone!: () => void;
		this.roundDone = new Promise<void>((resolve) => {
			markRoundDone = resolve;
		});
		try {
			const root = this.options.getKnowledgeRoot();
			await knowledge.ensureKnowledgeDirs(root);
			const now = this.now();
			const prepared = await knowledge.prepareRound(root, now);

			if (knowledge.isEmptyDiff(prepared.diff) && prepared.toReap.length === 0) {
				this.options.logger.info("no raws changes, nothing to process");
				this.scheduleCurrentSnapshot();
				return { skipped: true };
			}
			this.options.effects.recordProcessingRound();
			this.setProcessing(true);
			this.options.logger.info(
				`processing round: +${prepared.diff.added.length} ~${prepared.diff.changed.length} ` +
					`moved=${prepared.diff.moved.length} del=${prepared.diff.deleted.length} reap=${prepared.toReap.length}`,
			);

			if (knowledge.diffNeedsProcessing(prepared.diff)) {
				await this.runProcessingBatches(prepared.diff, root, modelKey, agentConcurrency, reasoningLevel, round);
			} else {
				this.options.logger.info("engineering-only round (moved/deleted/orphan reap), skipping LLM");
			}

			await knowledge.finalizeRound(root, prepared.toReap);
			if (!round.aborted) {
				const attempted = knowledge.attemptedFiles(prepared.diff);
				await knowledge.reconcileRoundFailures(root, attempted, now);
				this.scheduleProcessingOutcome(root, attempted);
			}
			this.scheduleCurrentSnapshot();
			this.options.effects.statusesChanged();
			this.options.logger.info("processing round complete");
			return { skipped: false };
		} finally {
			this.setProcessing(false);
			this.running = false;
			this.currentRound = undefined;
			markRoundDone();
			this.roundDone = undefined;
		}
	}

	async runMaintenance<T>(fn: (root: string) => Promise<T>): Promise<T> {
		await this.abort();
		if (this.running) throw new Error("知识库正在整理中，请稍后再试");
		this.running = true;
		try {
			const root = this.options.getKnowledgeRoot();
			await knowledge.ensureKnowledgeDirs(root);
			return await fn(root);
		} finally {
			this.running = false;
			this.options.effects.statusesChanged();
		}
	}

	async retryFailed(modelKey?: string, agentConcurrency = 3, reasoningLevel?: string): Promise<KnowledgeRoundResult> {
		await this.runMaintenance(async (root) => {
			const failures = await knowledge.readFailures(root);
			await knowledge.writeFailures(root, knowledge.clearFailures(failures));
		});
		return this.run(modelKey, agentConcurrency, reasoningLevel);
	}

	async recordCurrentSnapshot(): Promise<void> {
		const root = this.options.getKnowledgeRoot();
		try {
			await knowledge.ensureKnowledgeDirs(root);
			const [kbCount, raws, wiki] = await Promise.all([
				countKnowledgeBaseDirs(root),
				knowledge.scanRaws(root),
				knowledge.scanWikiPages(root),
			]);
			this.options.effects.recordSnapshot({
				kbCount,
				totalSourceFiles: raws.length,
				wikiPageCount: wiki.pages.length,
			});
		} catch (error) {
			this.options.logger.warn(`record knowledge snapshot failed: ${errorMessage(error)}`);
		}
	}

	scheduleCurrentSnapshot(): void {
		if (this.snapshotRunning) {
			this.snapshotPending = true;
			return;
		}
		this.snapshotRunning = true;
		void (async () => {
			try {
				do {
					this.snapshotPending = false;
					await this.recordCurrentSnapshot();
				} while (this.snapshotPending);
			} finally {
				this.snapshotRunning = false;
			}
		})();
	}

	private setProcessing(next: boolean): void {
		if (this.processing === next) return;
		this.processing = next;
		this.options.effects.processingChanged(next);
	}

	private async runProcessingBatches(
		diff: knowledge.RawsDiff,
		root: string,
		modelKey: string,
		agentConcurrency: number,
		reasoningLevel: string | undefined,
		round: RoundToken,
	): Promise<void> {
		const tmpDirectory = await this.options.temporaryDirectory.create();
		await this.options.rawsLock.begin(root);
		try {
			const writeSession = await knowledge.createKnowledgePageWriter(root);
			const batches = await knowledge.planProcessingBatches(diff, root, {
				maxFilesPerBatch: KB_MAX_FILES_PER_BATCH,
				maxBytesPerBatch: KB_MAX_BYTES_PER_BATCH,
			});
			this.options.logger.info(`processing in ${batches.length} batch(es), agent concurrency=${agentConcurrency}`);
			const limit = createLimiter(agentConcurrency);
			await Promise.all(
				batches.map((batch) =>
					limit.run(async () => {
						if (round.aborted) return;
						await this.runProcessingBatch(
							batch,
							root,
							tmpDirectory,
							writeSession,
							modelKey,
							reasoningLevel,
							round,
						);
						if (round.aborted) return;
						await this.refreshCachesAndNotify(root);
					}),
				),
			);
		} finally {
			await this.options.rawsLock.end(root);
			await this.options.temporaryDirectory.remove(tmpDirectory).catch(() => {});
		}
	}

	private async runProcessingBatch(
		batch: knowledge.RawsDiff,
		root: string,
		tmpDirectory: string,
		writeSession: knowledge.KnowledgePageWriter,
		modelKey: string,
		reasoningLevel: string | undefined,
		round: RoundToken,
	): Promise<void> {
		if (round.aborted) return;
		const rawsBase = knowledge.rawsDir(root);
		const todoItems = [
			...batch.added.map((added) => `新建 wiki 页：${join(rawsBase, added.raw.source_path)}`),
			...batch.changed.map((changed) => `更新 wiki 页（id=${changed.id}）：${join(rawsBase, changed.source_path)}`),
		];
		const session = await this.options.sessionFactory.create({
			cwd: this.options.sessionCwd,
			sessionDir: this.options.sessionDir,
			modelKey,
			reasoningLevel,
			todoItems,
			writer: writeSession,
			appendSystemPrompt: knowledge.KB_PROCESSING_GUIDE,
			env: { TMPDIR: tmpDirectory, TEMP: tmpDirectory, TMP: tmpDirectory },
		});
		round.sessions.add(session);
		const unsubscribeUsage = session.subscribeUsage(this.options.effects.recordProcessingUsage);
		try {
			if (round.aborted) return;
			await session.run(knowledge.buildProcessingPrompt(batch, root, tmpDirectory));
		} finally {
			unsubscribeUsage();
			round.sessions.delete(session);
			await session.dispose();
		}
	}

	private async refreshCachesAndNotify(root: string): Promise<void> {
		if (this.cacheRebuildRunning) {
			this.cacheRebuildPending = true;
			return;
		}
		this.cacheRebuildRunning = true;
		try {
			do {
				this.cacheRebuildPending = false;
				this.options.effects.reportDamagedPages(await knowledge.rebuildAllCaches(root));
				this.options.effects.statusesChanged();
			} while (this.cacheRebuildPending);
		} catch (error) {
			this.options.logger.warn(`interim cache rebuild failed: ${errorMessage(error)}`);
		} finally {
			this.cacheRebuildRunning = false;
		}
	}

	private scheduleProcessingOutcome(root: string, attempted: knowledge.AttemptedFile[]): void {
		if (attempted.length === 0) return;
		void (async () => {
			try {
				const [filesProcessed, failuresAfter] = await Promise.all([
					countProcessedFiles(root, attempted),
					knowledge.readFailures(root),
				]);
				this.options.effects.recordProcessingResult(
					filesProcessed,
					countQuarantinedAttempted(failuresAfter, attempted),
				);
			} catch (error) {
				this.options.logger.warn(`record knowledge processing outcome failed: ${errorMessage(error)}`);
			}
		})();
	}
}

async function countKnowledgeBaseDirs(root: string): Promise<number> {
	try {
		const entries = await readdir(knowledge.rawsDir(root), { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length;
	} catch {
		return 0;
	}
}

async function countProcessedFiles(root: string, attempted: knowledge.AttemptedFile[]): Promise<number> {
	if (attempted.length === 0) return 0;
	const { pages } = await knowledge.scanWikiPages(root);
	const presentByPath = new Map(
		pages
			.filter((page) => page.frontmatter.orphaned_at == null)
			.map((page) => [page.frontmatter.source_path, page.frontmatter.source_hash]),
	);
	return attempted.filter((file) => presentByPath.get(file.source_path) === file.source_hash).length;
}

function countQuarantinedAttempted(after: knowledge.FailuresRecord, attempted: knowledge.AttemptedFile[]): number {
	const attemptedPaths = new Set(attempted.map((file) => file.source_path));
	let count = 0;
	for (const [path, entry] of Object.entries(after.entries)) {
		if (!attemptedPaths.has(path) || !entry.quarantined) continue;
		count += 1;
	}
	return count;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
