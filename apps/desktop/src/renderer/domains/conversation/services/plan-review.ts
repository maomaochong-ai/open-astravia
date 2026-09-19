/**
 * 计划审批的纯逻辑：把计划正文切成可逐条评论的步骤，并把用户的意见合成一段发给模型的反馈。
 * 不依赖 React 与 IPC，便于直接测试。
 */

export type PlanSegment =
	| { readonly kind: "text"; readonly key: string; readonly markdown: string }
	| {
			readonly kind: "step";
			readonly key: string;
			readonly number: number;
			/** 步骤首行去掉序号后的文字，用作反馈里的定位锚点。 */
			readonly title: string;
			readonly markdown: string;
	  };

const STEP_START = /^(\d{1,3})[.)]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const MAX_TITLE_LENGTH = 80;

/**
 * 只把顶层（行首无缩进）的有序列表项识别为步骤；缩进的续行、嵌套列表和代码块都归属于当前步骤。
 * 识别不出步骤时整份计划是一个文本段——审批照常可用，只是没有逐条评论。
 */
export function splitPlanIntoSegments(plan: string): PlanSegment[] {
	const segments: PlanSegment[] = [];
	let lines: string[] = [];
	let step: { number: number; title: string } | undefined;
	let inFence = false;

	const flush = (): void => {
		const markdown = lines.join("\n").replace(/^\n+|\n+$/g, "");
		lines = [];
		if (!markdown.trim()) return;
		const key = `${segments.length}`;
		segments.push(step ? { kind: "step", key, ...step, markdown } : { kind: "text", key, markdown });
	};

	for (const line of plan.replace(/\r\n/g, "\n").split("\n")) {
		if (FENCE.test(line)) inFence = !inFence;
		const stepStart = inFence ? null : STEP_START.exec(line);
		if (stepStart) {
			flush();
			step = { number: Number(stepStart[1]), title: toStepTitle(stepStart[2] ?? "") };
		} else if (step && !inFence && line.length > 0 && !/^\s/.test(line)) {
			// 顶格的非列表行（标题、段落）结束当前步骤。
			flush();
			step = undefined;
		}
		lines.push(line);
	}
	flush();
	return segments;
}

function toStepTitle(text: string): string {
	const plain = text.replace(/[*_`]/g, "").trim();
	return plain.length > MAX_TITLE_LENGTH ? `${plain.slice(0, MAX_TITLE_LENGTH - 1)}…` : plain;
}

export interface PlanStepComment {
	readonly number: number;
	readonly title: string;
	readonly comment: string;
}

/**
 * 合成发给模型的修改意见。步骤意见带上序号与标题，模型据此定位；骨架用英文是因为它属于
 * 模型可见的协议文本，用户写的意见原样保留。
 */
export function composePlanFeedback(general: string, stepComments: readonly PlanStepComment[]): string {
	const parts = stepComments
		.filter(({ comment }) => comment.trim().length > 0)
		.map(({ number, title, comment }) => `- Step ${number} (${title}): ${comment.trim()}`);
	const overall = general.trim();
	if (parts.length === 0) return overall;
	return [...(overall ? [overall, ""] : []), "Comments on specific steps:", ...parts].join("\n");
}
