import { readFile } from "node:fs/promises";
import { Notification, type WebContents } from "electron";
import { mainT } from "../i18n/index.js";
import { readConfigSync } from "../ipc/fs.js";
import { getMainWindow, iconPath, showMainWindow } from "../window-manager.js";

/** 渲染端→主进程：上报聊天页当前所在 session（离开聊天页传 null）。 */
export const NOTIFICATION_SET_FOREGROUND_CHANNEL = "vetta:notification:set-foreground-session";
/** 主进程→渲染端：用户点击系统通知后下发的路由意图。 */
export const NOTIFICATION_NAVIGATE_CHANNEL = "vetta:notification:navigate";

/**
 * 系统通知的判别联合（见 CONTEXT.md「通知类型」）。横向扩充新类型时，
 * 在这里加一个分支，并在 shouldSuppress / buildDescriptor 各补一段即可；
 * 已有类型不受影响。当前唯一成员是 [[agent 完成通知]]。
 */
export type AppNotification =
	| {
			type: "agent-turn-complete";
			/** session jsonl 路径，既是点击路由目标，也是「同 session 合并」的 key。 */
			sessionPath: string;
			cwd: string;
			/** agent_end 正常完成 vs error 收尾——只影响正文文案。 */
			outcome: "completed" | "error";
	  }
	| {
			/** agent 调用 ask_user_question、有问题待用户确认。 */
			type: "agent-question-pending";
			sessionPath: string;
			cwd: string;
	  };

/** 点击通知后推给渲染端的路由意图（按 type 分流）。 */
export type NotificationNavigatePayload = {
	type: "agent-turn-complete" | "agent-question-pending";
	sessionPath: string;
	cwd: string;
};

interface NotificationDescriptor {
	title: string;
	body: string;
	/** 同 key 的通知互相替换（合并为一条）。 */
	coalesceKey: string;
	navigate: NotificationNavigatePayload;
}

let webContents: WebContents | null = null;
export function setNotificationWebContents(wc: WebContents | null): void {
	webContents = wc;
}

/** 渲染端上报的「聊天页当前所在 session path」；不在聊天页时为 null。 */
let foregroundSessionPath: string | null = null;
export function setForegroundSessionPath(path: string | null): void {
	foregroundSessionPath = path;
}

/** 已展示且未关闭的通知，按 coalesceKey 索引，用于「同 session 合并为一条」。 */
const activeNotifications = new Map<string, Notification>();

/** 关闭所有在屏通知（窗口/渲染端销毁时清理）。 */
export function closeAllNotifications(): void {
	for (const n of activeNotifications.values()) n.close();
	activeNotifications.clear();
}

/**
 * 通知抑制规则（见 CONTEXT.md「通知抑制规则」）。唯一不弹的情形：
 * 窗口聚焦 且 用户正停在该 session 的聊天页。
 */
function shouldSuppress(n: AppNotification): boolean {
	switch (n.type) {
		case "agent-turn-complete":
		case "agent-question-pending": {
			// 用户正聚焦看着该 session 时不打扰——问答面板已在他眼前。
			const win = getMainWindow();
			const focused = win?.isFocused() ?? false;
			return focused && foregroundSessionPath === n.sessionPath;
		}
	}
}

async function buildDescriptor(n: AppNotification): Promise<NotificationDescriptor> {
	switch (n.type) {
		case "agent-turn-complete": {
			return {
				title: await resolveSessionTitle(n.sessionPath),
				body: n.outcome === "error" ? mainT("notification.turnError") : mainT("notification.turnComplete"),
				coalesceKey: n.sessionPath,
				navigate: { type: "agent-turn-complete", sessionPath: n.sessionPath, cwd: n.cwd },
			};
		}
		case "agent-question-pending": {
			return {
				title: await resolveSessionTitle(n.sessionPath),
				body: mainT("notification.questionPending"),
				// 与完成通知用不同 key，避免两类事件互相覆盖。
				coalesceKey: `question:${n.sessionPath}`,
				navigate: { type: "agent-question-pending", sessionPath: n.sessionPath, cwd: n.cwd },
			};
		}
	}
}

export async function notify(n: AppNotification): Promise<void> {
	if (!Notification.isSupported()) return;
	// 全局总开关（「通用设置」），默认开；显式 false 才静默。
	if (readConfigSync().notificationsEnabled === false) return;
	if (shouldSuppress(n)) return;

	const desc = await buildDescriptor(n);

	// 同 session 合并：先关掉旧的那条，再弹新的。
	activeNotifications.get(desc.coalesceKey)?.close();

	const notification = new Notification({
		title: desc.title,
		body: desc.body,
		icon: iconPath[process.platform],
	});
	activeNotifications.set(desc.coalesceKey, notification);

	notification.on("click", () => {
		activeNotifications.delete(desc.coalesceKey);
		showMainWindow();
		if (webContents && !webContents.isDestroyed()) {
			webContents.send(NOTIFICATION_NAVIGATE_CHANNEL, desc.navigate);
		}
	});
	notification.on("close", () => {
		if (activeNotifications.get(desc.coalesceKey) === notification) {
			activeNotifications.delete(desc.coalesceKey);
		}
	});
	notification.show();
}

/** 从 user message 的 content（string 或 block 数组）里抽出纯文本。 */
function extractUserText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content as Array<Record<string, unknown>>) {
		if (block && block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

/** 抹掉首条用户消息里的 @file / /skill: / /scene: 前缀行，只留真正的诉求文本。 */
function stripPrefixLines(text: string): string {
	return text
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			return t.length > 0 && !t.startsWith("@") && !t.startsWith("/skill:") && !t.startsWith("/scene:");
		})
		.join(" ")
		.trim();
}

/**
 * 解析通知标题=session 名：优先 jsonl header 的 name（重命名/auto-title 后写入），
 * 否则回退首条用户消息截断；都没有则「新会话」。
 */
async function resolveSessionTitle(sessionPath: string): Promise<string> {
	const fallback = mainT("notification.sessionFallback");
	if (!sessionPath) return fallback;
	try {
		const text = await readFile(sessionPath, "utf8");
		let firstUser: string | undefined;
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			let entry: Record<string, unknown>;
			try {
				entry = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}
			if (entry.type === "session" && typeof entry.name === "string" && entry.name.trim()) {
				return entry.name.trim();
			}
			if (firstUser === undefined && entry.type === "message") {
				const msg = entry.message as { role?: string; content?: unknown } | undefined;
				if (msg?.role === "user") firstUser = stripPrefixLines(extractUserText(msg.content));
			}
		}
		if (firstUser) {
			const normalized = firstUser.replace(/\s+/g, " ").trim();
			if (normalized) return normalized.length > 40 ? `${normalized.slice(0, 40)}…` : normalized;
		}
	} catch {
		// 读不到就回退
	}
	return fallback;
}
