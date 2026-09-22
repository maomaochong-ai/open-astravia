import {
	type AutomationNotification,
	renderAutomationTemplate,
	type ScheduledTask,
	type TaskExecutionRecord,
} from "../../shared/automation.js";
import { mainT } from "../i18n/index.js";
import { getWebhookManager } from "../webhook/index.js";

/** webhook 单条消息的保守长度：飞书/钉钉文本上限都在数千字符，回复截断到这里。 */
const MAX_REPLY_CHARS = 3000;

type FinishedStatus = "success" | "failed" | "aborted";

function shouldNotify(notification: AutomationNotification, status: FinishedStatus): boolean {
	if (status === "aborted") return false;
	if (notification.when === "always") return true;
	return notification.when === (status === "success" ? "success" : "failure");
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "—";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * 执行结束后按任务配置发 webhook；返回失败说明（全部成功或无需发送时为 undefined）。
 * 通知失败只记进执行记录，不改变执行状态本身。
 */
export async function notifyAutomationFinished(
	task: ScheduledTask,
	record: TaskExecutionRecord,
	reply: string,
): Promise<string | undefined> {
	const notification = task.notification;
	const status = record.status;
	if (!notification || (status !== "success" && status !== "failed" && status !== "aborted")) return undefined;
	if (!shouldNotify(notification, status)) return undefined;
	const text = renderAutomationTemplate(notification.template, {
		name: task.name,
		status: mainT(`automation:notify.status.${status}`),
		startedAt: new Date(record.startedAt).toLocaleString(),
		duration: formatDuration(record.durationMs),
		reply: reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS)}…` : reply,
		error: record.error ?? "",
	});
	try {
		const results = await getWebhookManager().broadcast(
			{ title: task.name, text, level: status === "success" ? "success" : "error" },
			{ onlyIds: [...notification.webhookIds] },
		);
		const failures = results.filter((result) => !result.ok);
		if (results.length === 0) return mainT("automation:notify.noEndpoint");
		return failures.length > 0
			? failures.map((result) => `${result.name}: ${result.error ?? "unknown error"}`).join("; ")
			: undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
