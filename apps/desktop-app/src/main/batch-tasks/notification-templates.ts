import type { WebhookMessage } from "../webhook/index.js";
import type { BatchTaskStatus } from "./batch-task-state.js";
import type { BatchProject, BatchTask } from "./batch-task-storage.js";

/**
 * Render a duration in human-friendly Chinese form.
 *
 * 0–59s        → "42 秒"
 * 1–59min      → "3 分 42 秒"
 * 1h+          → "1 小时 24 分"
 */
function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) return `${totalSec} 秒`;
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min < 60) {
		return sec === 0 ? `${min} 分` : `${min} 分 ${sec} 秒`;
	}
	const hr = Math.floor(min / 60);
	const m2 = min % 60;
	return m2 === 0 ? `${hr} 小时` : `${hr} 小时 ${m2} 分`;
}

/** Format a Date as `YYYY-MM-DD HH:mm:ss` in local time. */
function formatTimestamp(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * ASCII progress bar — 20 cells of `█` / `░`. The chosen cell chars render
 * with predictable width across Feishu and DingTalk's markdown renderers and
 * stay aligned in mobile.
 */
function progressBar(done: number, total: number, width = 20): string {
	if (total <= 0) return "░".repeat(width);
	const ratio = Math.max(0, Math.min(1, done / total));
	const filled = Math.round(ratio * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

interface StatusCounts {
	pending: number;
	running: number;
	completed: number;
	failed: number;
	paused: number;
	total: number;
}

function countStatuses(tasks: BatchTask[]): StatusCounts {
	const counts: StatusCounts = {
		pending: 0,
		running: 0,
		completed: 0,
		failed: 0,
		paused: 0,
		total: tasks.length,
	};
	for (const t of tasks) {
		counts[t.status as BatchTaskStatus] = (counts[t.status as BatchTaskStatus] ?? 0) + 1;
	}
	return counts;
}

const STATUS_ROWS: readonly { key: keyof Omit<StatusCounts, "total">; label: string }[] = [
	{ key: "completed", label: "✅ 成功" },
	{ key: "failed", label: "❌ 失败" },
	{ key: "running", label: "🔄 运行中" },
	{ key: "pending", label: "⏳ 待执行" },
];

/**
 * Render the status breakdown as a bullet list. Feishu's `lark_md` and
 * DingTalk's markdown both ignore GFM table syntax (the user reported seeing
 * raw `|`-separated rows in the Feishu card), so we use a list instead — both
 * renderers handle `- ` lists and inline bold/code correctly.
 */
function buildStatusList(counts: StatusCounts): string {
	return STATUS_ROWS.map(({ key, label }) => `- ${label}：**${counts[key]}**`).join("\n");
}

/** Strip newlines from error messages so they don't break table rows. */
function sanitizeError(err: string | undefined): string {
	if (!err) return "未知错误";
	return err.replace(/\s+/g, " ").trim().slice(0, 200);
}

// =============================================================================
// Per-task message
// =============================================================================

export type TaskOutcome =
	| { kind: "completed" }
	| { kind: "failed"; error: string }
	| { kind: "timeout" }
	| { kind: "artifact-missing"; missing: string[] };

interface TaskFinishedContext {
	project: BatchProject;
	task: BatchTask;
	outcome: TaskOutcome;
	startedAt: number | undefined;
	finishedAt: number;
	modelKey: string | undefined;
}

export function buildTaskFinishedMessage(ctx: TaskFinishedContext): WebhookMessage {
	const { project, task, outcome, startedAt, finishedAt, modelKey } = ctx;
	// `project` 是 saveTaskState 之后才读的，本次刚结束的子任务**已经**反映在快照里
	// （completed / failed 已经记账）。所以直接用 counts 即可，不要再手动 +1。
	const counts = countStatuses(project.tasks);
	const runningCount = project.tasks.filter((t) => t.status === "running" && t.id !== task.id).length;
	const duration = startedAt ? formatDuration(finishedAt - startedAt) : "—";

	const success = outcome.kind === "completed";
	const title = `[${project.name}] ${success ? "✅" : "❌"} 子任务${success ? "已完成" : "失败"}`;

	const resultLine = (() => {
		switch (outcome.kind) {
			case "completed":
				return "✅ 成功";
			case "failed":
				return `❌ 失败`;
			case "timeout":
				return "⏰ 超时";
			case "artifact-missing":
				return "❌ 产物缺失";
		}
	})();

	const errorLine = (() => {
		switch (outcome.kind) {
			case "completed":
				return null;
			case "failed":
				return `**错误**：${sanitizeError(outcome.error)}`;
			case "timeout":
				return "**错误**：任务超时（60 分钟未完成）";
			case "artifact-missing":
				return `**错误**：产物缺失：${outcome.missing.join("、")}`;
		}
	})();

	const finishedSoFar = counts.completed + counts.failed;
	const pct = counts.total > 0 ? Math.round((finishedSoFar / counts.total) * 100) : 0;

	const lines: string[] = [
		"**子任务**：`****`",
		`**结果**：${resultLine}`,
		...(errorLine ? [errorLine] : []),
		`**耗时**：${duration}`,
		`**模型**：\`${modelKey ?? "—"}\``,
		"",
		"---",
		"",
		`**总进度** \`${progressBar(finishedSoFar, counts.total)}\` ${finishedSoFar} / ${counts.total} (${pct}%)`,
		"",
		buildStatusList(counts),
		"",
		`**正在运行**：**${runningCount}** 个`,
		`**等待队列**：${counts.pending} 个`,
		"",
		"---",
		"",
		`📁 项目：${project.name}`,
		`🕒 完成于：${formatTimestamp(finishedAt)}`,
	];

	return {
		title,
		text: lines.join("\n"),
		level: success ? "success" : "error",
	};
}

// =============================================================================
// Project summary message
// =============================================================================

interface ProjectSummaryContext {
	project: BatchProject;
	finishedAt: number;
}

/**
 * Decide whether the project as a whole has reached a terminal state. We
 * consider the project "done" when there is at least one finished task AND no
 * tasks are still pending / running.
 */
export function isProjectFinished(tasks: BatchTask[]): boolean {
	const counts = countStatuses(tasks);
	if (counts.total === 0) return false;
	if (counts.pending + counts.running > 0) return false;
	return counts.completed + counts.failed > 0;
}

export function buildProjectSummaryMessage(ctx: ProjectSummaryContext): WebhookMessage {
	const { project, finishedAt } = ctx;
	const counts = countStatuses(project.tasks);

	const failed = project.tasks.filter((t) => t.status === "failed");
	const completed = counts.completed;
	const allSuccess = counts.failed === 0 && completed > 0;
	const allFailed = completed === 0 && counts.failed > 0;
	const level: WebhookMessage["level"] = allSuccess ? "success" : allFailed ? "error" : "warn";

	const titleEmoji = allSuccess ? "🎉" : allFailed ? "💥" : "⚠️";
	const title = `${titleEmoji} ${project.name} 全部完成（${completed} 成功 / ${counts.failed} 失败）`;

	// 总耗时 = 最早 startedAt → 最晚 completedAt（基于 task-states.json 的 lastModified 近似，
	// 准确性已足够汇报；不强求秒级精确）。
	const startTimes = project.tasks
		.map((t) => (t as { startedAt?: number }).startedAt)
		.filter((v): v is number => typeof v === "number");
	const earliestStart = startTimes.length > 0 ? Math.min(...startTimes) : undefined;
	const endTimes = project.tasks.map(
		(t) => (t as { completedAt?: number; updatedAt: number }).completedAt ?? t.updatedAt,
	);
	const latestEnd = endTimes.length > 0 ? Math.max(...endTimes) : finishedAt;
	const totalMs = earliestStart !== undefined ? latestEnd - earliestStart : undefined;
	const avgMs = totalMs !== undefined && counts.total > 0 ? totalMs / counts.total : undefined;

	const failureList = (() => {
		const max = 10;
		const shown = failed.slice(0, max).map((t) => `- \`****\`：${sanitizeError(t.error)}`);
		if (failed.length > max) {
			shown.push(`- ... 还有 ${failed.length - max} 条`);
		}
		return shown;
	})();

	const summaryList = [
		`- ✅ 成功：**${completed}**`,
		`- ❌ 失败：**${counts.failed}**`,
		`- 合计：**${counts.total}**`,
	].join("\n");

	const lines: string[] = [
		`${titleEmoji} **批量项目执行完毕**`,
		"",
		summaryList,
		"",
		`**总耗时**：${totalMs !== undefined ? formatDuration(totalMs) : "—"}（首任务开始 → 末任务完成）`,
		`**平均耗时**：${avgMs !== undefined ? formatDuration(avgMs) : "—"} / 任务`,
		`**并发度**：${project.concurrency}`,
	];

	if (failed.length > 0) {
		lines.push("", "**失败列表**：", ...failureList);
	}

	lines.push("", "---", "", `📁 项目：${project.name}`, `🕒 完成于：${formatTimestamp(finishedAt)}`);

	return {
		title,
		text: lines.join("\n"),
		level,
	};
}
