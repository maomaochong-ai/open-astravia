/**
 * 定时任务 session 的命名约定。
 *
 * 会话名 = 「任务名 · 时间」，干净无前缀。是否为定时 session 由调度执行记录里的
 * sessionPath 判定（见 scheduledSessionPathsAtom），不再依赖会话名里的任何标记。
 *
 * SCHEDULE_SESSION_MARKER 是历史遗留的不可见前缀（U+E000，落在图标字体私有区会渲染成
 * 乱码字形）。新会话不再写入；仅在 sessionDisplayLabel 里剥离，兼容已经写进磁盘的旧会话。
 */
export const SCHEDULE_SESSION_MARKER = String.fromCharCode(0xe000);

/** 构造定时 session 的展示名：任务名 · 时间（MM-DD HH:mm）。 */
export function formatScheduleSessionName(taskName: string, startedAt: number): string {
	const d = new Date(startedAt);
	const pad = (n: number): string => String(n).padStart(2, "0");
	const time = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return `${taskName} · ${time}`;
}
