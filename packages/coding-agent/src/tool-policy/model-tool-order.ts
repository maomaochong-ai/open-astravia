/**
 * Coding Agent Tool Surface 的产品顺序合同。
 *
 * 顺序值只在各 Registration/Feature 组装时使用；Composer 和 Runtime Core 不认识具体工具名。
 * 相邻值保留间隔，允许后续能力在不重编号既有工具的情况下插入。
 */
export const CODING_AGENT_MODEL_TOOL_ORDER = Object.freeze({
	read: 100,
	command: 200,
	edit: 300,
	write: 400,
	grep: 500,
	glob: 600,
	find: 700,
	ls: 800,
	directoryTree: 900,
	docToPdf: 1_000,
	htmlToPdf: 1_100,
	extractTextFromPdf: 1_200,
	extractTextFromImage: 1_300,
	renderPdfPage: 1_400,
	currentTime: 1_500,
	progress: 1_600,
	knowledgeWrite: 1_700,
	knowledgeFilter: 1_800,
	knowledgeTags: 1_900,
	invokeSkill: 2_000,
	todo: 2_100,
	toolSearch: 2_200,
	taskOutput: 2_300,
	taskStop: 2_400,
	subagentStart: 2_500,
	askUserQuestion: 3_200,
	plugin: 3_300,
});

export const CODING_AGENT_SUBAGENT_MODEL_TOOL_ORDER_STEP = 100;
