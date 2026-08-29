#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BANNED = [
	"我们很高兴",
	"我们激动",
	"无缝",
	"赋能",
	"解锁",
	"行业领先",
	"革命性",
	"best-in-class",
	"seamlessly",
	"empower",
	"leverage",
	"unlock",
	"at the end of the day",
	"without further ado",
];
const PLACEHOLDER = [/待补/, /TODO/i, /TBD/i, /某某/, /<待/, /\[待/];
const VETTA_TERMS = [
	"Vetta",
	"local-first",
	"本地优先",
	"BYOK",
	"Skill",
	"MCP",
	"Plugin",
	"Theme",
	"Session",
	"artifact",
	"知识库",
	"自动化",
	"权限",
	"可审查",
];
const GENERIC_HEADINGS = new Set(["背景", "架构", "结果", "结论", "Background", "Architecture", "Results", "Conclusion"]);

export function validateArticle(articlePath, options = {}) {
	const article = readFileSync(articlePath, "utf8").replace(/^\uFEFF/, "");
	const evidence = readJson(options.evidencePath);
	const visualReview = readJson(options.visualReviewPath);
	const errors = [];
	const warnings = [];
	const checks = {};

	const marked = /<!--\s*vetta-blog:\s*article\s*-->/i.test(article) || /^\s*vetta-blog:\s*(?:true|article)\s*$/im.test(article);
	checks.marker = marked;
	if (!marked) errors.push("缺少 `<!-- vetta-blog: article -->` 标记，hook 不会把它识别为博客正文。");

	const h1 = [...article.matchAll(/^#\s+(.+)$/gm)].map((match) => match[1].trim());
	const h2 = [...article.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
	checks.singleH1 = h1.length === 1;
	checks.informativeHeadings = h2.filter((heading) => GENERIC_HEADINGS.has(heading)).length === 0;
	if (h1.length !== 1) errors.push(`H1 数量应为 1，当前为 ${h1.length}。`);
	if (h2.length < 2) errors.push("至少需要两个能表达信息的 H2，不能只靠摘要或列表撑起文章。");
	if (!checks.informativeHeadings) errors.push("存在 `背景/架构/结果/结论` 这类无信息标题，请改成读者能据此判断内容的标题。");

	const charCount = [...article.replace(/```[\s\S]*?```/g, "")].length;
	checks.substantial = charCount >= 600;
	if (charCount < 600) warnings.push(`正文约 ${charCount} 字，低于 600 字基线；确认不是把 changelog 或实测压成了空泛摘要。`);

	const banned = BANNED.filter((term) => article.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
	checks.naturalLanguage = banned.length === 0;
	if (banned.length > 0) errors.push(`出现空泛/企业或 AI 套话：${banned.join("、")}。`);
	const placeholders = PLACEHOLDER.filter((pattern) => pattern.test(article)).map((pattern) => pattern.source);
	checks.noPlaceholders = placeholders.length === 0;
	if (placeholders.length > 0) errors.push("存在待补或模板占位符，不能进入发布候选。");

	const distinctTerms = VETTA_TERMS.filter((term) => article.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
	checks.vettaRelevance = distinctTerms.length >= 2;
	if (distinctTerms.length < 2) errors.push("Vetta 相关词不足两个；请把论点落到真实产品、仓库路径、用户任务或项目边界。");
	checks.readerValue = /下一步|开始|试试|文档|源码|下载|验证|how to|try|docs|source/i.test(article);
	if (!checks.readerValue) errors.push("缺少可执行的下一步或验证动作，读者读完无法继续。");
	checks.experience = /我(们)?\s*(在|用|将|运行|测试|复现|测量|观察|遇到|尝试|记录)|实测|复现|实验|observed|tested|measured/i.test(article);
	if (!checks.experience) errors.push("缺少真实操作、复现或测量痕迹；不能用“实测/体验”作没有记录的结论。");
	checks.tradeoffs = /取舍|局限|不适合|失败|限制|代价|边界|trade-?off|limitation|doesn['’]t fit/i.test(article);
	if (!checks.tradeoffs) errors.push("缺少取舍、局限、失败或不适用场景。");
	const links = [...article.matchAll(/https:\/\/[^\s)\]>]+/g)].map((match) => match[0]);
	checks.sourceLinks = links.length >= 1;
	if (links.length === 0) errors.push("正文至少需要一个可复核的 HTTPS 来源链接；更细的 claim 映射放在 evidence.json。");
	const paragraphs = article.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
	const duplicateParagraphs = paragraphs.filter((part, index) => paragraphs.indexOf(part) !== index && part.length > 80);
	checks.noDuplicateParagraphs = duplicateParagraphs.length === 0;
	if (duplicateParagraphs.length > 0) warnings.push("发现重复长段落；删除重复摘要，保留一次并补充新证据。");

	const evidenceResult = validateEvidence(evidence, article, options.evidencePath);
	Object.assign(checks, evidenceResult.checks);
	errors.push(...evidenceResult.errors);
	warnings.push(...evidenceResult.warnings);

	const visualResult = validateVisualReview(visualReview, options.visualReviewPath, options.requireVisual !== false);
	Object.assign(checks, visualResult.checks);
	errors.push(...visualResult.errors);
	warnings.push(...visualResult.warnings);

	const score = scoreChecks(checks);
	const verdict = errors.length > 0 ? "BLOCK" : score < 12 ? "FIX" : "SHIP";
	return {
		status: verdict === "SHIP" ? "pass" : verdict === "FIX" ? "needs_revision" : "blocked",
		verdict,
		articlePath: resolve(articlePath),
		score,
		checks,
		errors,
		warnings,
		links,
		observedAt: new Date().toISOString(),
	};
}

function validateEvidence(evidence, article, evidencePath) {
	const checks = {};
	const errors = [];
	const warnings = [];
	if (!evidence) {
		checks.evidencePresent = false;
		errors.push(evidencePath ? `无法读取 evidence.json：${evidencePath}` : "缺少 evidence.json；建立事实、来源和体验台账后再发布。");
		return { checks, errors, warnings };
	}
	checks.evidencePresent = true;
	const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
	const sources = Array.isArray(evidence.sources) ? evidence.sources : [];
	const experiments = Array.isArray(evidence.experiments) ? evidence.experiments : [];
	const claimIds = claims.map((claim) => claim?.id);
	const sourceIdsList = sources.map((source) => source?.id);
	const experimentIds = experiments.map((experiment) => experiment?.id);
	const validStatuses = new Set(["verified", "partial", "unverified", "contradicted", "opinion"]);
	checks.claimsStructured = claims.length > 0 && claims.every((claim) => typeof claim?.id === "string" && claim.id.length > 0 && validStatuses.has(claim?.status)) && new Set(claimIds).size === claimIds.length;
	checks.sourcesStructured = sources.length > 0 && sources.every((source) => typeof source?.id === "string" && source.id.length > 0 && /^https:\/\//.test(source?.url ?? "") && validDate(source?.accessed_at)) && new Set(sourceIdsList).size === sourceIdsList.length;
	const artifactRoots = [evidencePath ? resolve(evidencePath, "..") : process.cwd(), process.cwd()];
	const artifactExists = (path) => artifactRoots.some((root) => existsSync(resolve(root, path)));
	const completeExperiment = (experiment) => {
		const result = ["pass", "partial", "fail", "unverified"].includes(experiment?.result);
		const base = typeof experiment?.id === "string" && validDate(experiment?.date) && typeof experiment?.environment === "string" && experiment.environment.length > 0 && typeof experiment?.input === "string" && experiment.input.length > 0 && Array.isArray(experiment?.steps) && experiment.steps.length > 0 && experiment.steps.every((step) => typeof step === "string" && step.length > 0) && typeof experiment?.observed === "string" && experiment.observed.length > 0 && result && Number.isInteger(experiment?.retries) && experiment.retries >= 0 && Array.isArray(experiment?.claim_ids) && experiment.claim_ids.length > 0;
		if (!base) return false;
		if (experiment.result === "unverified") return typeof experiment.reason === "string" && experiment.reason.length > 0;
		return Array.isArray(experiment.artifact_paths) && experiment.artifact_paths.length > 0 && experiment.artifact_paths.every((path) => typeof path === "string" && path.length > 0 && artifactExists(path));
	};
	checks.experimentRecorded = experiments.length > 0 && new Set(experimentIds).size === experimentIds.length && experiments.every(completeExperiment) && experiments.every((experiment) => experiment.claim_ids.every((id) => claimIds.includes(id)));
	if (!checks.claimsStructured) errors.push("evidence.json 的 claims 必须包含唯一 id 和 status。");
	if (!checks.sourcesStructured) errors.push("evidence.json 的 sources 必须包含 id、HTTPS url 和 accessed_at。");
	if (!checks.experimentRecorded) errors.push("evidence.json 的 experiments 必须记录环境、输入、步骤、结果、重试次数、断言关联和 artifact；未实测必须说明原因。");
	const sourceIds = new Set(sources.map((source) => source.id));
	const highClaims = claims.filter((claim) => claim.importance === "high");
	const highVerified = highClaims.length > 0 && highClaims.every((claim) => claim.status === "verified" && claim.counterevidence_checked === true && Array.isArray(claim.evidence_ids) && claim.evidence_ids.length > 0 && claim.evidence_ids.every((id) => sourceIds.has(id)) && article.includes(`<!-- claim:${claim.id} -->`));
	checks.highClaimsVerified = highVerified;
	if (!highVerified) errors.push("所有 high claim 必须 verified、检查反证、映射来源，并在正文放置对应的 <!-- claim:C1 --> 标记。");
	const referencedIds = new Set(claims.flatMap((claim) => Array.isArray(claim.evidence_ids) ? claim.evidence_ids : []));
	checks.evidenceCoverage = sources.length > 0 && [...referencedIds].every((id) => sourceIds.has(id));
	if (!checks.evidenceCoverage) errors.push("claims 引用的 evidence_id 在 sources 中不存在。");
	const supportsClaims = sources.every((source) => !Array.isArray(source.supports) || source.supports.every((id) => claimIds.includes(id)));
	if (!supportsClaims) errors.push("sources.supports 只能引用存在的 claim id，避免证据台账与正文脱节。");
	const firstPartyKinds = new Set(["first_party_code", "first_party_test", "first_party_docs", "first_party_release"]);
	const firstPartyClaimIds = new Set(sources.filter((source) => firstPartyKinds.has(source.kind)).flatMap((source) => Array.isArray(source.supports) ? source.supports : []));
	checks.repoFacts = firstPartyClaimIds.size >= 3;
	if (!checks.repoFacts) errors.push("至少需要 3 个由 Vetta 一方源码、测试、文档或 release 支持的事实 claim。");
	checks.revisionLogged = Array.isArray(evidence.revision_log) && evidence.revision_log.length > 0 && evidence.revision_log.every((item) => typeof item?.issue === "string" && typeof item?.change === "string" && Array.isArray(item?.rechecked_claim_ids));
	if (!checks.revisionLogged) errors.push("evidence.json 必须记录至少一轮 revision_log，并列出复核过的 claim。");
	const invalidDates = sources.filter((source) => !validDate(source.accessed_at));
	if (invalidDates.length > 0) errors.push("所有来源的 accessed_at 必须是可解析日期。");
	const volatileClaims = claims.filter((claim) => claim.volatile === true);
	if (volatileClaims.some((claim) => !claim.published_at && !claim.observed_at)) errors.push("易变 claim（价格、版本、平台支持等）必须带 published_at 或 observed_at。");
	const isComparison = /comparison|比较|替代|选型/i.test(String(evidence.article_type ?? "")) || /竞品|替代|对比/.test(article);
	if (isComparison) {
		const competitors = Array.isArray(evidence.competitors) ? evidence.competitors : [];
		const protocol = evidence.comparison_protocol;
		const protocolOk = protocol && typeof protocol.task === "string" && typeof protocol.input === "string" && Array.isArray(protocol.criteria) && protocol.criteria.length >= 2 && typeof protocol.stop_condition === "string" && typeof protocol.deliverable_standard === "string";
		const externalOfficial = sources.filter((source) => ["competitor_docs", "competitor_release", "official_docs", "official_release"].includes(source.kind) && withinDays(source.accessed_at, 180));
		const competitorsOk = competitors.length >= 1 && competitors.every((item) => typeof item?.name === "string" && typeof item?.fit === "string" && typeof item?.tradeoff === "string" && Array.isArray(item.source_ids) && item.source_ids.length > 0 && item.source_ids.every((id) => sourceIds.has(id)) && Array.isArray(item.experiment_ids) && item.experiment_ids.length > 0 && item.experiment_ids.every((id) => experimentIds.includes(id)));
		checks.competitorMatrix = protocolOk && competitorsOk && externalOfficial.length >= 2;
		if (!checks.competitorMatrix) errors.push("比较文章需要共同任务协议、至少一个竞品（含来源和实测关联），以及近 180 天内至少两个外部官方来源。");
	}
	if (Array.isArray(evidence.revision_log) && evidence.revision_log.length > 0) checks.revisionLogged = true;
	if (!evidence.observed_at) warnings.push("evidence.json 缺少 observed_at，近期版本、价格或平台断言会难以复核。");
	return { checks, errors, warnings };
}

function validDate(value) {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function withinDays(value, days) {
	if (!validDate(value)) return false;
	return (Date.now() - Date.parse(value)) / 86_400_000 <= days && Date.parse(value) <= Date.now();
}

function validateVisualReview(review, reviewPath, required) {
	const checks = {};
	const errors = [];
	const warnings = [];
	if (!review) {
		checks.visualReviewPresent = false;
		if (required) errors.push("博客发布候选必须提供 visual-review.json，并完成实际图片审查。");
		else warnings.push("未提供 visual-review.json；图片交付未纳入本次校验。");
		return { checks, errors, warnings };
	}
	checks.visualReviewPresent = true;
	checks.visualFilePresent = false;
	checks.visualApproved = review.status === "approved";
	checks.visualDimensions = Number.isInteger(review.width) && Number.isInteger(review.height) && review.width >= 1200 && review.height >= 630;
	const requiredChecks = ["article_thesis", "vetta_palette_roles", "title_safe_area", "mobile_crop", "legibility_and_artifacts"];
	checks.visualChecksPass = requiredChecks.every((key) => review.checks?.[key] === "pass");
	if (!checks.visualApproved) errors.push("visual-review.json 必须在查看实际像素后标记 status=approved。");
	if (!checks.visualDimensions) errors.push("图片至少需要 1200×630；请按目标页面检查比例和裁切。");
	if (!checks.visualChecksPass) errors.push("图片必须通过主题相关性、Vetta 色彩角色、标题安全区、移动裁切和清晰度/伪影检查。");
	const imagePath = review.path && reviewPath ? (isAbsolute(review.path) ? review.path : resolve(reviewPath, "..", review.path)) : undefined;
	checks.visualFilePresent = Boolean(imagePath && existsSync(imagePath) && statSync(imagePath).isFile());
	if (required && !imagePath) errors.push("visual-review.json 必须提供实际图片 path。");
	if (required && !checks.visualFilePresent) errors.push(`visual-review.json 指向的图片不存在：${imagePath ?? "(missing path)"}`);
	if (required && review.pixel_checked !== true) errors.push("必须完成实际像素查看并设置 pixel_checked=true。");
	if (required && !validDate(review.checked_at)) errors.push("必须记录可解析的 checked_at。");
	if (required && (!review.brief_path || !reviewPath || !existsSync(resolve(reviewPath, "..", review.brief_path)))) errors.push("必须提供可读取的 visual-brief.md。");
	const candidates = Array.isArray(review.candidates) ? review.candidates : [];
	const candidateFilesOk = candidates.length >= 2 && candidates.every((candidate) => typeof candidate?.id === "string" && typeof candidate?.path === "string" && typeof candidate?.axis === "string" && reviewPath && existsSync(resolve(reviewPath, "..", candidate.path)));
	checks.visualCandidates = candidateFilesOk;
	if (required && !candidateFilesOk) errors.push("必须提供至少两个真实候选图片，并记录每个只改变一个轴的比较维度。");
	if (required && (!review.selected_candidate_id || !candidates.some((candidate) => candidate.id === review.selected_candidate_id) || typeof review.selection_reason !== "string" || review.selection_reason.length === 0)) errors.push("必须记录选中的候选及选择理由。");
	if (imagePath) {
		const imagePath = isAbsolute(review.path) ? review.path : resolve(reviewPath, "..", review.path);
		if (checks.visualFilePresent) {
			const actual = readImageDimensions(imagePath);
			if (!actual) errors.push("无法从图片头信息读取实际像素尺寸。");
			else if (actual.width !== review.width || actual.height !== review.height) errors.push("visual-review.json 的尺寸与实际图片头信息不一致。");
		}
	}
	return { checks, errors, warnings };
}

function readImageDimensions(filePath) {
	const bytes = readFileSync(filePath);
	if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
		if (bytes.toString("ascii", 12, 16) === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) { offset += 1; continue; }
			const marker = bytes[offset + 1];
			const length = bytes.readUInt16BE(offset + 2);
			if (marker >= 0xc0 && marker <= 0xc3) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
			if (length < 2) break;
			offset += 2 + length;
		}
	}
	return undefined;
}

function scoreChecks(checks) {
	const dimensions = [
		["readerValue", "evidencePresent"],
		["highClaimsVerified", "evidenceCoverage"],
		["experience", "experimentRecorded"],
		["vettaRelevance", "claimsStructured"],
		["tradeoffs", "competitorMatrix"],
		["singleH1", "informativeHeadings"],
		["naturalLanguage", "noDuplicateParagraphs"],
		["visualApproved", "visualChecksPass"],
	];
	return dimensions.reduce((total, keys) => total + (keys.every((key) => checks[key] === true) ? 2 : 0), 0);
}

function readJson(filePath) {
	if (!filePath || !existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function parseArgs(argv) {
	const args = { articlePath: undefined, evidencePath: undefined, visualReviewPath: undefined, json: false, fromTranscript: false, requireVisual: false };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--evidence") args.evidencePath = argv[++index];
		else if (value === "--visual-review") args.visualReviewPath = argv[++index];
		else if (value === "--json") args.json = true;
		else if (value === "--from-transcript") args.fromTranscript = true;
		else if (value === "--require-visual") args.requireVisual = true;
		else if (!value.startsWith("-") && !args.articlePath) args.articlePath = value;
	}
	return args;
}

function extractPaths(value, output = new Set()) {
	if (!value || typeof value !== "object") return output;
	if (Array.isArray(value)) {
		for (const item of value) extractPaths(item, output);
		return output;
	}
	for (const [key, child] of Object.entries(value)) {
		if (["file_path", "path", "filename", "target_file"].includes(key) && typeof child === "string" && /\.(?:md|mdx|markdown)$/i.test(child)) output.add(child);
		if (child && typeof child === "object") extractPaths(child, output);
	}
	return output;
}

async function readStdin() {
	return await new Promise((resolveInput) => {
		let input = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => { input += chunk; if (input.length > 2_000_000) process.stdin.destroy(); });
		process.stdin.on("end", () => resolveInput(input));
		process.stdin.on("error", () => resolveInput(input));
	});
}

function candidateInsideProject(candidate, projectDir) {
	const absolute = resolve(projectDir, candidate);
	const rel = relative(resolve(projectDir), absolute);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function renderFeedback(result) {
	const lines = [`vetta-blog ${result.verdict}（${result.score}/16）`];
	if (result.errors.length) lines.push(`硬问题：${result.errors.slice(0, 6).join("；")}`);
	if (result.warnings.length) lines.push(`提醒：${result.warnings.slice(0, 4).join("；")}`);
	lines.push("请修复最影响读者决定的项，再运行 validate-blog.mjs；不要用增加空泛段落凑分。");
	return lines.join("\n");
}

async function runHook(input) {
	let payload;
	try { payload = JSON.parse(input); } catch { return; }
	const eventName = payload?.hook_event_name ?? payload?.hookEventName;
	const projectDir = typeof payload?.cwd === "string" ? payload.cwd : process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
	let candidates = new Set();
	if (eventName === "PostToolUse") candidates = extractPaths(payload.tool_input ?? payload.toolInput);
	if (eventName === "Stop" && typeof payload.transcript_path === "string" && existsSync(payload.transcript_path)) {
		try {
			const transcript = readFileSync(payload.transcript_path, "utf8").slice(-1_000_000);
			for (const line of transcript.split("\n").slice(-500)) { try { candidates = new Set([...candidates, ...extractPaths(JSON.parse(line))]); } catch { /* ignore malformed transcript lines */ } }
		} catch { /* fail open when the host transcript is unavailable */ }
	}
	const results = [];
	for (const candidate of candidates) {
		if (!candidateInsideProject(candidate, projectDir)) continue;
		const articlePath = resolve(projectDir, candidate);
		if (!existsSync(articlePath)) continue;
		const text = readFileSync(articlePath, "utf8");
		if (!/<!--\s*vetta-blog:\s*article\s*-->|^\s*vetta-blog:\s*(?:true|article)\s*$/im.test(text)) continue;
		const evidencePath = join(articlePath, "..", "evidence.json");
		const visualReviewPath = join(articlePath, "..", "visual-review.json");
		results.push(validateArticle(articlePath, { evidencePath, visualReviewPath }));
	}
	if (results.length === 0) return;
	const failed = results.filter((result) => result.verdict !== "SHIP");
	const feedback = results.map(renderFeedback).join("\n\n");
	if (eventName === "Stop" && failed.length > 0 && payload.stop_hook_active !== true) {
		process.stdout.write(JSON.stringify({ decision: "block", reason: feedback.slice(0, 4000) }));
	} else {
		process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName ?? "PostToolUse", additionalContext: feedback.slice(0, 6000) } }));
	}
}

const isMainModule = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed.articlePath) {
		const result = validateArticle(resolve(parsed.articlePath), parsed);
		if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		else process.stdout.write(`${renderFeedback(result)}\n`);
		process.exitCode = result.verdict === "SHIP" ? 0 : 1;
	} else {
		await runHook(await readStdin());
	}
}
