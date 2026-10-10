/**
 * 压缩摘要的「显示表示」清洗。
 *
 * 持久化的 `summary` 曾经把机器工作状态（`<runtime-work-state>{JSON}</runtime-work-state>`，
 * 在飞 todo + 后台任务的完整 shell 命令与临时日志路径，实测约 6KB 转义 JSON）直接拼在叙述
 * 末尾，而压缩卡原样透传该字段给 Markdown 渲染器 —— 展开卡片后末尾就是一堵 JSON 墙。
 *
 * 写端已修正（work-state 只进模型可见的 `summaryMessage`），但历史记录带着污染内容落盘，
 * 旧会话照旧会显示乱码，所以读端也必须剥离。这里只做纯字符串清洗，不改写任何持久化数据。
 */

/** 机器工作状态块：只对模型有意义，不该出现在人看的摘要里。闭合块精确匹配，未闭合（截断写入）清到结尾。 */
const WORK_STATE_BLOCK = /<runtime-work-state>[\s\S]*?<\/runtime-work-state>|<runtime-work-state>[\s\S]*$/g;

/** 摘要标签残迹：模型偶尔会把投影里的闭合标签复读出来，提取器已在新记录上拦住，旧记录兜底。 */
const SUMMARY_MARKER = /<\/?summary>/g;

/** 清洗后可能留下的连续空行。 */
const EXCESS_BLANK_LINES = /\n{3,}/g;

export function toCompactionDisplaySummary(summary: string): string {
	return summary.replace(WORK_STATE_BLOCK, "").replace(SUMMARY_MARKER, "").replace(EXCESS_BLANK_LINES, "\n\n").trim();
}
