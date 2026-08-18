import type { ActionDefinition, ActionSearchResult } from "./types.js";

/** 同义簇：查询命中任一词时，可匹配簇内其它词所在的文档。 */
const SYNONYM_CLUSTERS: readonly (readonly string[])[] = [
	["scheduler", "schedule", "scheduled", "cron", "定时", "定时任务", "计划任务", "自动化", "automation"],
	["batch-tasks", "batch", "batchtask", "批量", "批量任务", "批处理", "批量执行"],
	["appearance", "theme", "themes", "主题", "外观", "皮肤", "配色"],
	["cursor", "pointer", "鼠标", "鼠标指针", "指针", "光标", "白鼬", "stoat", "鼠标样式"],
	["dark", "深色", "暗色", "夜间", "night"],
	["light", "浅色", "亮色", "日间", "day"],
	["auto", "跟随系统", "系统", "system"],
	["navigation", "navigate", "open", "goto", "打开", "跳转", "导航", "页面", "page", "pages"],
	[
		"settings",
		"setting",
		"config",
		"configuration",
		"preferences",
		"设置",
		"配置",
		"偏好设置",
		"偏好",
		"general",
		"通用",
	],
	["agent", "Agent", "实验", "experimental", "人设", "个性化"],
	// 能力页统一了 skill / 场景 / MCP / 插件 / 套装（ADR-0049），这些词都应命中同一处。
	[
		"skills",
		"skill",
		"abilities",
		"ability",
		"能力",
		"能力页",
		"插件",
		"技能",
		"技能广场",
		"marketplace",
		"plugin",
		"plugins",
		"bundle",
		"能力套装",
	],
	["downloads", "download", "下载", "下载中心"],
	["chat", "对话", "聊天", "会话", "主页", "首页"],
	["create", "创建", "新建", "新增", "add", "new"],
	["update", "更新", "修改", "编辑", "edit", "patch", "change"],
	["delete", "删除", "移除", "remove"],
	["list", "列表", "列出", "查询", "query", "get", "read", "查看", "help", "帮助"],
	["run", "执行", "运行", "start", "开始", "启动"],
	["stop", "停止", "中止", "abort", "cancel", "取消"],
	["enable", "启用", "开启", "打开开关"],
	["disable", "停用", "禁用", "关闭"],
	["history", "历史", "执行历史", "记录"],
	["retry", "重试"],
	["reset", "重置"],
	["resume", "继续", "恢复"],
	["model", "models", "模型", "provider", "服务商", "defaultModel"],
	["mcp", "MCP"],
	["skill", "skills", "技能", "scene"],
	["project", "projects", "项目", "会话", "session"],
	["knowledge", "知识库", "wiki", "加工"],
	["plugin", "plugins", "插件"],
	["im", "claw", "飞书", "微信"],
	["webhook", "推送", "钉钉", "机器人"],
	["download", "downloads", "下载"],
	["update", "updater", "更新", "升级", "版本"],
	["language", "语言", "中文", "英文", "zh", "en"],
];

const DOMAIN_KEYWORDS: Record<string, readonly string[]> = {
	appearance: [
		"theme",
		"主题",
		"外观",
		"深色",
		"浅色",
		"dark",
		"light",
		"auto",
		"模式",
		"皮肤",
		"鼠标",
		"指针",
		"cursor",
		"白鼬",
	],
	navigation: ["open", "打开", "跳转", "导航", "页面", "设置", "settings", "page"],
	"batch-tasks": ["批量", "批量任务", "批处理", "batch", "项目", "子任务", "并发"],
	scheduler: ["定时", "定时任务", "计划任务", "自动化", "cron", "schedule", "调度"],
	models: ["模型", "model", "provider", "服务商", "defaultModel", "API Key"],
	mcp: ["mcp", "MCP", "服务器", "tools"],
	skills: [
		"技能",
		"能力",
		"能力页",
		"skill",
		"scene",
		"技能广场",
		"扩展",
		"插件",
		"plugin",
		"mcp",
		"能力套装",
		"bundle",
	],
	projects: ["项目", "project", "会话", "session", "侧边栏", "归档"],
	general: ["通用", "general", "通知", "workspace", "工作区", "沙盒", "执行模式", "settings"],
	agent: ["agent", "Agent", "实验", "experimental", "Vetta CLI", "输入预测", "agentSkills"],
	knowledge: ["知识库", "knowledge", "wiki", "加工", "索引"],
	plugins: ["插件", "plugin", "扩展"],
	im: ["im", "claw", "飞书", "微信", "旁路"],
	webhook: ["webhook", "推送", "飞书", "钉钉", "机器人"],
	downloads: ["下载", "download", "下载中心"],
	updater: ["更新", "update", "版本", "升级"],
};

interface SearchDocument {
	action: ActionDefinition;
	result: ActionSearchResult;
	/** 主键字段：id / domain / title */
	primary: string;
	/** 次要：summary / keywords / domain 默认词 */
	secondary: string;
	/** 全文：schema、operation、example 等 */
	tertiary: string;
	all: string;
}

function normalize(text: string): string {
	return text.normalize("NFKC").toLowerCase().trim();
}

/** 分词：空白/标点切分；保留字母数字与 CJK；id 内的 . - _ 再拆一层。 */
export function tokenizeQuery(query: string): string[] {
	const normalized = normalize(query);
	if (!normalized) return [];

	const raw = normalized
		.split(/[^\p{L}\p{N}.+\-_]+/u)
		.flatMap((part) => part.split(/[.\-_]+/u))
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

	// 去重且保持顺序
	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const token of raw) {
		if (seen.has(token)) continue;
		seen.add(token);
		tokens.push(token);
	}
	return tokens;
}

function buildSynonymIndex(): Map<string, readonly string[]> {
	const index = new Map<string, readonly string[]>();
	for (const cluster of SYNONYM_CLUSTERS) {
		const normalized = cluster.map((term) => normalize(term)).filter(Boolean);
		const unique = Array.from(new Set(normalized));
		for (const term of unique) {
			index.set(term, unique);
		}
	}
	return index;
}

const SYNONYM_INDEX = buildSynonymIndex();

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/u;

/** 中文长词拆成 2–4 字滑动窗口，便于「深色模式」命中「深色」。 */
function cjkSubterms(token: string): string[] {
	if (token.length < 2 || !CJK_CHAR.test(token)) return [];
	const terms: string[] = [];
	const maxN = Math.min(token.length, 4);
	for (let n = 2; n <= maxN; n++) {
		for (let i = 0; i + n <= token.length; i++) {
			terms.push(token.slice(i, i + n));
		}
	}
	return terms;
}

/** 每个查询词扩展为一组等价词（含自身、同义词、中文子串）。 */
export function expandToken(token: string): string[] {
	const normalized = normalize(token);
	if (!normalized) return [];

	const seeds = new Set<string>([normalized, ...cjkSubterms(normalized)]);
	const expanded = new Set<string>();
	for (const seed of seeds) {
		expanded.add(seed);
		const cluster = SYNONYM_INDEX.get(seed);
		if (cluster) {
			for (const term of cluster) expanded.add(term);
		}
	}
	return Array.from(expanded);
}

function collectText(parts: Array<string | undefined | null | readonly string[]>): string {
	const chunks: string[] = [];
	for (const part of parts) {
		if (part === undefined || part === null) continue;
		if (typeof part === "string") {
			if (part.trim()) chunks.push(part);
			continue;
		}
		for (const item of part) {
			if (item.trim()) chunks.push(item);
		}
	}
	return normalize(chunks.join("\n"));
}

function buildSearchDocument(action: ActionDefinition): SearchDocument {
	const operationNames = action.inputSchema.operations?.map((operation) => operation.name) ?? [];
	const operationDescriptions = action.inputSchema.operations?.map((operation) => operation.description) ?? [];
	const parameterText =
		action.inputSchema.operations?.flatMap((operation) =>
			operation.parameters.flatMap((parameter) => [parameter.name, parameter.description, parameter.type]),
		) ?? [];
	const exampleText = action.examples.flatMap((example) => [example.description, JSON.stringify(example.input)]);
	const approvalText =
		action.approval?.presentations.flatMap((presentation) => [
			presentation.id,
			presentation.title,
			presentation.description,
		]) ?? [];
	const domainKeywords = DOMAIN_KEYWORDS[action.domain] ?? [];

	const primary = collectText([action.id, action.domain, action.title, ...action.id.split(/[.\-_]/u)]);
	const secondary = collectText([action.summary, action.permission, action.keywords, domainKeywords, operationNames]);
	const tertiary = collectText([
		action.inputSchema.description,
		operationDescriptions,
		parameterText,
		exampleText,
		approvalText,
	]);
	const all = collectText([primary, secondary, tertiary]);

	return {
		action,
		result: {
			id: action.id,
			domain: action.domain,
			title: action.title,
			summary: action.summary,
			availability: action.availability,
		},
		primary,
		secondary,
		tertiary,
		all,
	};
}

function fieldScore(field: string, term: string, weight: number): number {
	if (!term || !field.includes(term)) return 0;
	// 完整字段相等 / 词边界感更强时加分
	if (field === term) return weight * 4;
	// 作为独立片段（前后为空白或标点）略加分
	const boundary = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}([^\\p{L}\\p{N}]|$)`, "u");
	if (boundary.test(field)) return weight * 2;
	// 前缀匹配（英文 id 片段）
	if (field.startsWith(term) || field.includes(` ${term}`) || field.includes(`.${term}`)) {
		return Math.round(weight * 1.5);
	}
	return weight;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bestTermScore(doc: SearchDocument, terms: string[]): number {
	let best = 0;
	for (const term of terms) {
		if (term.length < 1) continue;
		const lengthBonus = Math.min(term.length, 12);
		const primary = fieldScore(doc.primary, term, 12 + lengthBonus);
		const secondary = fieldScore(doc.secondary, term, 7 + lengthBonus);
		const tertiary = fieldScore(doc.tertiary, term, 3 + Math.min(lengthBonus, 6));
		best = Math.max(best, primary, secondary, tertiary);
	}
	return best;
}

export function scoreSearchDocument(doc: SearchDocument, query: string): number {
	const normalizedQuery = normalize(query);
	if (!normalizedQuery) return 1;

	const tokens = tokenizeQuery(normalizedQuery);
	if (tokens.length === 0) return 1;

	let score = 0;

	// 完整查询短语命中：高权重
	if (doc.primary.includes(normalizedQuery)) score += 120;
	else if (doc.secondary.includes(normalizedQuery)) score += 80;
	else if (doc.all.includes(normalizedQuery)) score += 40;

	let matchedGroups = 0;
	for (const token of tokens) {
		const alternatives = expandToken(token);
		const tokenScore = bestTermScore(doc, alternatives);
		if (tokenScore > 0) {
			matchedGroups += 1;
			score += tokenScore;
		}
	}

	if (matchedGroups === 0) return 0;

	// 多词查询：匹配比例奖励；过少命中时降权但不直接丢弃（避免「主题颜色」因「颜色」漏检而空结果）
	const coverage = matchedGroups / tokens.length;
	score = Math.round(score * (0.55 + 0.45 * coverage));
	score += matchedGroups * 15;

	// 多词时若只命中 1 个且总词数 ≥ 3，需要更强字段分才保留
	if (tokens.length >= 3 && matchedGroups === 1 && score < 40) return 0;

	return score;
}

export function searchActions(
	actions: Iterable<ActionDefinition>,
	options: { query?: string; domain?: string } = {},
): ActionSearchResult[] {
	const domain = options.domain?.trim();
	const query = options.query?.trim() ?? "";
	const documents: SearchDocument[] = [];

	for (const action of actions) {
		if (domain && action.domain !== domain) continue;
		documents.push(buildSearchDocument(action));
	}

	if (!query) {
		return documents
			.map((doc) => doc.result)
			.sort((a, b) => a.id.localeCompare(b.id) || a.domain.localeCompare(b.domain));
	}

	const ranked = documents
		.map((doc) => ({ doc, score: scoreSearchDocument(doc, query) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.doc.result.id.localeCompare(b.doc.result.id);
		});

	return ranked.map((entry) => entry.doc.result);
}
