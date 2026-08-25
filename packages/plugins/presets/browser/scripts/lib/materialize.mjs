/**
 * 策略快照（renderer 写的 runtime.json）→ agent-browser 原生配置。
 *
 * 纯函数，无 I/O，由单测覆盖。绝对路径由调用方传入——只有 wrapper 进程能正确解析
 * 插件数据目录（它拿得到完整 process.env，包括 VETTA_HOME / VETTA_CONFIG_DIR）。
 */

const DEFAULTS = {
	browserSource: "managed",
	headed: true,
	allowedDomains: "",
	denyEval: true,
	denyDownload: false,
	denyUpload: true,
	toolsProfile: "core",
	maxOutput: 20000,
};

const MIN_MAX_OUTPUT = 2000;
const MAX_MAX_OUTPUT = 500000;

function bool(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}

function clampMaxOutput(value) {
	const raw = typeof value === "number" ? value : Number.NaN;
	if (!Number.isFinite(raw)) return DEFAULTS.maxOutput;
	return Math.min(MAX_MAX_OUTPUT, Math.max(MIN_MAX_OUTPUT, Math.floor(raw)));
}

/**
 * 快照可能来自旧版本插件、被手工改坏，或者根本不存在。这里对每个字段独立兜底，
 * 而不是整份丢弃回默认——用户改过的那几项不该因为一个坏字段全部失效。
 */
export function normalizeSnapshot(raw) {
	const snapshot = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	return {
		browserSource: snapshot.browserSource === "attach" ? "attach" : "managed",
		headed: bool(snapshot.headed, DEFAULTS.headed),
		allowedDomains: typeof snapshot.allowedDomains === "string" ? snapshot.allowedDomains : DEFAULTS.allowedDomains,
		denyEval: bool(snapshot.denyEval, DEFAULTS.denyEval),
		denyDownload: bool(snapshot.denyDownload, DEFAULTS.denyDownload),
		denyUpload: bool(snapshot.denyUpload, DEFAULTS.denyUpload),
		toolsProfile:
			typeof snapshot.toolsProfile === "string" && snapshot.toolsProfile.trim().length > 0
				? snapshot.toolsProfile.trim()
				: DEFAULTS.toolsProfile,
		maxOutput: clampMaxOutput(snapshot.maxOutput),
	};
}

/**
 * @param {{ snapshot: object, profileDir: string, actionPolicyPath: string }} input
 * @returns {{ config: object, actionPolicy: object }}
 */
export function materializeAgentBrowserConfig(input) {
	const snapshot = normalizeSnapshot(input.snapshot);
	const deny = [];
	if (snapshot.denyEval) deny.push("eval");
	if (snapshot.denyDownload) deny.push("download");
	if (snapshot.denyUpload) deny.push("upload");

	const config = {
		headed: snapshot.headed,
		// 页面内容是不可信数据：让 agent-browser 用边界标记把它和工具输出区分开。
		contentBoundaries: true,
		maxOutput: snapshot.maxOutput,
		actionPolicy: input.actionPolicyPath,
		// 同一个 Chrome 里多会话并行时，各自钉住自己的 tab。
		pinTab: true,
	};

	// 互斥：附着模式复用用户已经在跑的 Chrome，此时再声明 profile（即 --user-data-dir）
	// 等于同时下达「复用现有浏览器」和「用独立数据目录另起一个」两条矛盾指令。
	if (snapshot.browserSource === "attach") config.autoConnect = true;
	else config.profile = input.profileDir;

	return { config, actionPolicy: { default: "allow", deny } };
}
