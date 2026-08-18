/**
 * 知识库后台惰性加工轮询器。
 *
 * 每 N 分钟（设置可配）跑一轮：工程侧算 raws diff + 处理 moved/孤儿标记，
 * 若有 added/changed/待回收孤儿，则起一个加工 agent 会话（落在
 * processing_records 特殊项目，可在 sidebar 回看），完成后工程侧 n+1 回收孤儿。
 *
 * 攒批：不追求实时，整批变更交给一个会话；同一时刻只跑一轮。
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as knowledge from "@vetta/runtime-knowledge";
import { BrowserWindow } from "electron";
import { AsyncTask, SimpleIntervalJob, ToadScheduler } from "toad-scheduler";
import { getOrCreateSharedModelRuntime } from "../agent-runtime/host-services.js";
import {
	recordKnowledgeBaseProcessingResult,
	recordKnowledgeBaseProcessingRound,
	recordKnowledgeBaseProcessingUsage,
	recordKnowledgeBaseSnapshot,
} from "../app-monitor/app-monitor-service.js";
import { KB_PROCESSING_CWD, KB_PROCESSING_SESSION_DIR, readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { getKnowledgeRoot } from "./knowledge-layout.js";
import { KnowledgeRoundController } from "./knowledge-round-controller.js";
import { createDesktopKnowledgeProcessingSessionFactory } from "./processing-session-factory.js";
import { beginRound, endRound, unlockRaws } from "./raws-lock.js";

/** 加工中状态：广播给渲染层（顶栏「正在建立索引…」徽标）。 */
export const KB_PROCESSING_CHANGED_CHANNEL = "vetta:kb:processing-changed";
/** 文件加工态可能已变（每批加工完缓存重建后）：渲染层据此重取文件列表状态。 */
export const KB_STATUSES_CHANGED_CHANNEL = "vetta:kb:statuses-changed";

function broadcast(channel: string, payload?: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(channel, payload);
	}
}

const log = getAppLogger("kb-poller");
const knowledgeProcessingSessionFactory = createDesktopKnowledgeProcessingSessionFactory({
	getModelRegistry: getOrCreateSharedModelRuntime,
});

/** 上报重建时被排除的坏页（frontmatter 非法/缺失）——否则其源文件永远静默显示未加工。 */
function logDamagedPages(result: knowledge.RebuildResult): void {
	if (result.damaged.length === 0) return;
	log.warn(
		`知识库有 ${result.damaged.length} 个 wiki 页 frontmatter 非法/缺失，已被排除出缓存（其源文件会显示未加工）：`,
	);
	for (const d of result.damaged) log.warn(`  损坏页 ${d.path} — ${d.message}`);
}

const roundController = new KnowledgeRoundController({
	sessionFactory: knowledgeProcessingSessionFactory,
	getKnowledgeRoot,
	sessionCwd: KB_PROCESSING_CWD,
	sessionDir: KB_PROCESSING_SESSION_DIR,
	effects: {
		processingChanged: (next) => broadcast(KB_PROCESSING_CHANGED_CHANNEL, next),
		statusesChanged: () => broadcast(KB_STATUSES_CHANGED_CHANNEL),
		recordProcessingRound: recordKnowledgeBaseProcessingRound,
		recordProcessingUsage: recordKnowledgeBaseProcessingUsage,
		recordProcessingResult: recordKnowledgeBaseProcessingResult,
		recordSnapshot: recordKnowledgeBaseSnapshot,
		reportDamagedPages: logDamagedPages,
	},
	rawsLock: {
		begin: (root) => beginRound(root),
		end: (root) => endRound(root),
	},
	temporaryDirectory: {
		async create() {
			const directory = join(tmpdir(), `vetta-kb-${randomUUID()}`);
			await mkdir(directory, { recursive: true });
			return directory;
		},
		remove: (path) => rm(path, { recursive: true, force: true }),
	},
	logger: log,
});

export function isKnowledgeProcessing(): boolean {
	return roundController.isProcessing();
}

const scheduler = new ToadScheduler();
const JOB_ID = "kb-poller";
let scheduled = false;
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;

/**
 * 立即中止正在进行的加工轮（若有）：对所有活动会话调 abort()，并等待该轮真正收尾
 * （running 归位、缓存对账完成）。无轮在跑则立即返回。用于关闭知识库开关、清空 wiki 等
 * 需要「马上停下后台加工」的场景。
 */
export async function abortKnowledgeRound(): Promise<void> {
	await roundController.abort();
}

export async function recordKnowledgeBaseCurrentSnapshot(): Promise<void> {
	await roundController.recordCurrentSnapshot();
}

export function scheduleKnowledgeBaseCurrentSnapshot(): void {
	roundController.scheduleCurrentSnapshot();
}

/** 跑一轮加工。返回是否因无变更而跳过。 */
export async function runKnowledgeRound(
	modelKey?: string,
	agentConcurrency = 3,
	reasoningLevel?: string,
): Promise<{ skipped: boolean; reason?: "no-model" }> {
	if (shuttingDown) return { skipped: true };
	return roundController.run(modelKey, agentConcurrency, reasoningLevel);
}

/**
 * 在「同一时刻只跑一轮」互斥锁下执行一段知识库维护（清空 wiki / 删除指定 wiki 页等）。
 * 复用 `running`：维护期间任何定时 tick 自动跳过；若正有一轮在跑则拒绝（让用户稍后再试），
 * 杜绝与加工轮的写 wiki / 重建缓存竞态。收尾广播一次状态变更，让侧边栏文件态与索引重新对账。
 */
export async function runKnowledgeMaintenance<T>(fn: (root: string) => Promise<T>): Promise<T> {
	return roundController.runMaintenance(fn);
}

/**
 * 重试加工失败（已隔离）的文件：清除全部失败/隔离记录（解除隔离），再立即起一轮加工。
 * 清除走维护互斥（会中止在跑的轮并独占执行），随后的加工轮按常规调度。
 */
export async function retryFailedKnowledge(
	modelKey?: string,
	agentConcurrency = 3,
	reasoningLevel?: string,
): Promise<{ skipped: boolean; reason?: "no-model" }> {
	if (shuttingDown) return { skipped: true };
	return roundController.retryFailed(modelKey, agentConcurrency, reasoningLevel);
}

function unschedule(): void {
	if (scheduled) {
		scheduler.removeById(JOB_ID);
		scheduled = false;
	}
}

/** 据当前配置（重新）调度轮询器。配置变化或启动时调用。 */
export async function reloadKnowledgePoller(): Promise<void> {
	if (shuttingDown) return;
	unschedule();
	// 自愈：清除上次进程崩溃可能残留的 raws 只读锁。
	// 仅当无加工轮进行时才清——进行中那一轮的锁是「活动锁」不是残留，
	// 误清会丢掉防 agent 污染 raws 的 OS 兜底（如用户正加工时保存了知识库设置）。
	if (!roundController.isRunning()) await unlockRaws().catch(() => {});
	const config = await readDesktopConfig();
	const kb = config.knowledgeBase;
	// 总开关：关闭时置 env 标志，coding-agent 据此对 agent 屏蔽知识库检索工具。
	process.env.VETTA_KNOWLEDGE_DISABLED = kb?.enabled === false ? "1" : "";
	if (!kb?.enabled) {
		// 关闭知识库总开关：立即中止正在进行的加工轮，杜绝后台继续读原文/写 wiki。
		await abortKnowledgeRound();
		await unlockRaws().catch(() => {});
		log.info("knowledge base disabled");
		return;
	}
	// 启动/改设置时自愈一次：据 frontmatter 重建缓存，覆盖缓存缺失/损坏/手改场景，
	// 用户无需任何手动「重建」操作。无 LLM、O(N)、隐形。加工轮进行中则跳过避免竞态。
	if (!roundController.isRunning()) {
		const root = getKnowledgeRoot();
		await knowledge.ensureKnowledgeDirs(root);
		await knowledge
			.rebuildAllCaches(root)
			.then(logDamagedPages)
			.catch((err) => log.warn(`self-heal rebuild failed: ${err instanceof Error ? err.message : String(err)}`));
	}
	// OCR 并发经环境变量传给 coding-agent 的全局 OCR 闸（惰性初始化，首次 OCR 调用时读取）。
	// 改 ocrConcurrency 后需重启 app 才生效。手动「马上整理」也读它，故不论是否自动都先设好。
	process.env.VETTA_KB_OCR_CONCURRENCY = String(kb.ocrConcurrency ?? 1);
	const minutes = kb.pollIntervalMinutes ?? 5;
	// 0/未设视作「永不自动加工」：保持知识库启用（检索工具、手动整理仍可用），仅不调度后台轮询。
	if (minutes <= 0) {
		log.info("knowledge auto-processing disabled (manual scan only)");
		return;
	}
	const modelKey = kb.processingModelKey;
	// 未配置加工模型则不调度自动整理（绝不回退默认模型）。检索/手动操作不受影响。
	if (!modelKey || modelKey.indexOf("/") <= 0) {
		log.info("knowledge auto-processing disabled (no processing model configured)");
		return;
	}
	const agentConcurrency = kb.agentConcurrency ?? 3;
	const reasoningLevel = kb.processingModelReasoningLevel;
	const task = new AsyncTask(
		JOB_ID,
		async () => {
			await runKnowledgeRound(modelKey, agentConcurrency, reasoningLevel);
		},
		(err: Error) => log.error(`knowledge round failed: ${err.message}`),
	);
	scheduler.addSimpleIntervalJob(new SimpleIntervalJob({ minutes, runImmediately: false }, task, { id: JOB_ID }));
	scheduled = true;
	log.info(`knowledge poller scheduled every ${minutes} min`);
}

export function stopKnowledgePoller(): void {
	unschedule();
	scheduler.stop();
}

/**
 * Desktop 进程退出时释放 Knowledge Poller 持有的全部资源。
 *
 * 关闭过程只执行一次：先阻止新轮次进入，再中止并等待当前轮释放 Session/Composition，
 * 最后幂等恢复 raws 写权限。异常由主进程生命周期边界统一记录。
 */
export function shutdownKnowledgePoller(): Promise<void> {
	shutdownPromise ??= (async () => {
		shuttingDown = true;
		stopKnowledgePoller();
		try {
			await abortKnowledgeRound();
		} finally {
			await unlockRaws();
		}
	})();
	return shutdownPromise;
}
