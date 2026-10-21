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

/** 摘要模板的小节标题：英文原文 → i18n 键。模板是英文字面量，模型照抄是常态，「把标题翻译掉」
 *  这条提示词只能影响新摘要，历史记录里已经写死了英文标题，所以读端必须再映射一次。 */
const HEADING_KEYS = {
	"Primary Goal": "primaryGoal",
	"Key Constraints & Preferences": "keyConstraints",
	"Current State of Work": "currentState",
	Completed: "completed",
	"In Progress": "inProgress",
	Blocked: "blocked",
	"Key Technical Decisions": "keyDecisions",
	"Files and Code Context": "filesAndCode",
	"Errors and Fixes": "errorsAndFixes",
	"User Intent History": "userIntent",
	"Pending Tasks": "pendingTasks",
	"Next Steps": "nextSteps",
} as const satisfies Record<string, string>;

export type CompactionHeadingKey = (typeof HEADING_KEYS)[keyof typeof HEADING_KEYS];

/** 取不到译文时返回 undefined，调用方保留原文。 */
export type CompactionHeadingResolver = (key: CompactionHeadingKey) => string | undefined;

/** ATX 标题行：`## ` / `### ` 后跟标题文本。 */
const HEADING_LINE = /^(#{2,4})[ \t]+(.+?)[ \t]*$/;

/** 代码围栏：摘要里附的代码片段可能出现 `## 注释`，那不是小节标题。 */
const FENCE_LINE = /^[ \t]*(?:```|~~~)/;

/**
 * 把摘要里的模板标题换成当前界面语言。
 *
 * 只替换与模板完全一致的标题行，模型自己写的中文标题、正文里同名的加粗词都不动；
 * 代码围栏内一律跳过。未知语言（`resolve` 返回 undefined）时原样返回。
 */
export function localizeCompactionHeadings(summary: string, resolve: CompactionHeadingResolver): string {
	let inFence = false;
	let changed = false;
	const lines = summary.split("\n").map((line) => {
		if (FENCE_LINE.test(line)) {
			inFence = !inFence;
			return line;
		}
		if (inFence) return line;
		const heading = HEADING_LINE.exec(line);
		if (!heading?.[1] || !heading[2]) return line;
		const key = HEADING_KEYS[heading[2] as keyof typeof HEADING_KEYS];
		if (!key) return line;
		const text = resolve(key);
		if (text === undefined || text === heading[2]) return line;
		changed = true;
		return `${heading[1]} ${text}`;
	});
	return changed ? lines.join("\n") : summary;
}

export function toCompactionDisplaySummary(summary: string, resolveHeading?: CompactionHeadingResolver): string {
	const cleaned = summary
		.replace(WORK_STATE_BLOCK, "")
		.replace(SUMMARY_MARKER, "")
		.replace(EXCESS_BLANK_LINES, "\n\n")
		.trim();
	return resolveHeading ? localizeCompactionHeadings(cleaned, resolveHeading) : cleaned;
}
