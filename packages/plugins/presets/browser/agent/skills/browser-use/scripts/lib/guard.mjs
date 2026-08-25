/**
 * shim 的门禁：对一次 `agent-browser <argv>` 调用做确定性判定。
 *
 * 为什么门禁在这里，而不是 PreToolUse Hook：模型调用的是 bash，Hook 只能拿到一整条 shell
 * 字符串，管道、`sh -c`、变量前缀都能把判定绕过去。shim 解析的是**自己的 argv**，是结构化的。
 *
 * 为什么不交给 agent-browser 自己：
 * - `--allowed-domains` 在上游与 `--profile` / `--auto-connect` 互斥，而这两种浏览器来源正是
 *   本插件仅有的两种模式，所以上游的域名围栏对我们永远不可用。
 * - `--confirm-actions` 的交互确认走 TTY，shim 是无 TTY 子进程，上游会一律自动拒绝。
 *
 * 判定命中即 block 并给出可操作理由（写到 stderr，进 bash 工具结果），让模型转述给用户，
 * 用户去面板改设置后重试。
 *
 * 这一层是 fail-open 的：认不出来的子命令一律放行。真正的兜底是 daemon 侧的
 * `--action-policy`（shim 每次都会带上），它不依赖 argv 解析是否准确。
 */

/** 由插件面板/设置统一管理的开关。用户命令里出现就拒，否则会把 shim 建立的策略整个顶掉。 */
const MANAGED_FLAGS = new Set([
	"--config",
	"--action-policy",
	"--allowed-domains",
	"--confirm-actions",
	"--confirm-interactive",
	"--profile",
	"--auto-connect",
	"--cdp",
	"--session",
	"--namespace",
	"--no-pin-tab",
	"--executable-path",
	"--extension",
	"--init-script",
	"--enable",
	"--args",
	"--allow-file-access",
	"--state",
	"--session-name",
	"--provider",
	"-p",
]);

/** 整条子命令不可用，并给出替代路径。 */
const BLOCKED_SUBCOMMANDS = {
	mcp: "本插件不再以 MCP 工具面暴露浏览器能力，直接用本 shim 的子命令即可。",
	connect: "浏览器来源由插件设置决定（托管浏览器 / 连接已打开的 Chrome），不能在命令里临时改。",
	chat: "`chat` 会在 Vetta 之外另起一个模型循环，不受本会话的工具策略与用量约束。请自己用 open/snapshot/click 完成任务。",
	plugin: "`plugin` 会安装并运行第三方代码，超出本插件声明的能力边界。",
	install: "运行时安装由「浏览器操作」面板负责（它会先判断本机是否已有 Chrome，避免白下几百 MB）。请让用户去面板点「安装」。",
	upgrade: "运行时升级由「浏览器操作」面板负责，它只装到 Vetta 自己的运行时目录，不动用户已有的全局安装。请让用户去面板点「升级」。",
};

/** 危险动作子命令 → action-policy 类别。daemon 侧也会拒，这里只是给出更好的理由文本。 */
const DANGEROUS_SUBCOMMANDS = {
	eval: "eval",
	upload: "upload",
	download: "download",
};

/**
 * 需要域名判定的子命令 → 从位置参数里取 URL 的下标。
 * 只列上游明确接受 URL 的位置，不做「看起来像域名就查」的猜测——那会把
 * `screenshot home.png` 里的文件名当成越界导航拦掉。
 */
const URL_POSITIONAL_BY_SUBCOMMAND = {
	open: [0],
	read: [0],
	pushstate: [0],
	vitals: [0],
	a11y: [0],
};

/** 带值的全局标志：解析子命令时要跳过它们的值，否则会把值误当成子命令。 */
const VALUE_FLAGS = new Set([
	"--url",
	"--model",
	"--device",
	"--user-agent",
	"--proxy",
	"--proxy-bypass",
	"--max-output",
	"--idle-timeout",
	"--engine",
	"--color-scheme",
	"--download-path",
	"--screenshot-dir",
	"--screenshot-quality",
	"--screenshot-format",
	"--headers",
	"--hide-scrollbars",
	"--restore-save",
	"--restore-check-url",
	"--restore-check-text",
	"--restore-check-fn",
	"--depth",
	"-d",
	"--selector",
	"-s",
	"--tags",
	"--filter",
	"--name",
	"--item",
	"--credential-provider",
	"--username",
	"--password",
	"--username-selector",
	"--password-selector",
	"--port",
	"--baseline",
	"--body",
]);

/**
 * 把 argv 拆成「标志 / 位置参数」。
 *
 * 无法覆盖上游全部标志的元数（arity），所以未知标志一律按布尔处理。误判的后果只是
 * 位置参数错位，而错位只会让域名判定认不出 URL —— 那是 fail-open 的一侧，由 daemon
 * 的 action-policy 兜底；不会造成把合法命令误拦。
 */
export function parseCommandLine(argv) {
	const flags = [];
	const positionals = [];
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (typeof token !== "string") continue;
		if (token.startsWith("-") && token !== "-") {
			const equals = token.indexOf("=");
			const name = equals >= 0 ? token.slice(0, equals) : token;
			const inlineValue = equals >= 0 ? token.slice(equals + 1) : undefined;
			let value = inlineValue;
			if (value === undefined && VALUE_FLAGS.has(name)) {
				value = argv[index + 1];
				index += 1;
			}
			flags.push({ name, value });
			continue;
		}
		positionals.push(token);
	}
	return { flags, positionals };
}

/** 规范化待检查的 URL 的 host；不是外部 http(s) 导航时返回 null。 */
export function extractHost(raw) {
	const text = String(raw ?? "").trim();
	if (text.length === 0) return null;
	// agent-browser 的 `read` 明确会把裸 host 补成 https，`open` 实践上同理，所以这里也必须
	// 容忍无 scheme 的输入——否则「open example.com」会被当成非法 URL 拦掉。
	const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) ? text : `https://${text}`;
	let url;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	// about:blank / data: / blob: 没有 host，不是外部导航，交给 action-policy 管。
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	return url.hostname.toLowerCase();
}

/** 白名单匹配：精确域名，或 `*.example.com` 前缀通配（同时匹配裸域，与上游语义一致）。 */
export function matchesAllowedDomain(host, patterns) {
	return patterns.some((pattern) => {
		if (pattern.startsWith("*.")) {
			const bare = pattern.slice(2);
			return host === bare || host.endsWith(`.${bare}`);
		}
		return host === pattern;
	});
}

/** 从一条命令里取出所有需要做域名判定的原始 URL 文本。 */
export function collectCandidateUrls(subcommand, positionals, flags) {
	const rest = positionals.slice(1);
	const found = [];

	for (const index of URL_POSITIONAL_BY_SUBCOMMAND[subcommand] ?? []) {
		if (rest[index] !== undefined) found.push(rest[index]);
	}
	// `tab new <url>` / `diff url <u1> <u2>` / `record start <path> [url]`：URL 的位置取决于
	// 第一个位置参数，单独列出来比在上表里编码更清楚。
	if (subcommand === "tab" && rest[0] === "new" && rest[1] !== undefined) found.push(rest[1]);
	if (subcommand === "diff" && rest[0] === "url") found.push(...rest.slice(1, 3));
	if (subcommand === "record" && rest[0] === "start" && rest[2] !== undefined) found.push(rest[2]);

	for (const flag of flags) {
		if (flag.name === "--url" && flag.value !== undefined) found.push(flag.value);
	}
	return found;
}

/**
 * 对一次调用做判定。
 *
 * @param {readonly string[]} argv 用户（模型）给出的 agent-browser 参数，不含可执行文件名
 * @param {{ allowedDomains: readonly string[], denyEval: boolean, denyDownload: boolean, denyUpload: boolean }} config
 * @returns {{ action: "allow" } | { action: "block", code: string, reason: string }}
 */
export function evaluateBrowserCommand(argv, config) {
	const { flags, positionals } = parseCommandLine(argv);

	for (const flag of flags) {
		if (MANAGED_FLAGS.has(flag.name)) {
			return {
				action: "block",
				code: "managed-flag",
				reason: `不允许在命令里使用 ${flag.name}：浏览器来源、会话、域名白名单与动作策略由「浏览器操作」插件统一管理。需要改动请让用户到「设置 → 插件 → 浏览器操作」里调整。`,
			};
		}
	}

	const subcommand = (positionals[0] ?? "").toLowerCase();
	if (subcommand.length === 0) return { action: "allow" };

	const blocked = BLOCKED_SUBCOMMANDS[subcommand];
	if (blocked !== undefined) {
		return { action: "block", code: "subcommand-blocked", reason: `不允许执行 \`${subcommand}\`。${blocked}` };
	}

	const category = DANGEROUS_SUBCOMMANDS[subcommand];
	if (category !== undefined) {
		const denied =
			(category === "eval" && config.denyEval) ||
			(category === "download" && config.denyDownload) ||
			(category === "upload" && config.denyUpload);
		if (denied) {
			return {
				action: "block",
				code: "action-denied",
				reason: `浏览器操作插件禁止了「${category}」类动作。如需放行，请让用户在「设置 → 插件 → 浏览器操作」里关闭对应开关。`,
			};
		}
	}

	if (config.allowedDomains.length === 0) return { action: "allow" };

	for (const raw of collectCandidateUrls(subcommand, positionals, flags)) {
		// 省略 url 是合法的（例如 read 读当前页），不算越界。
		if (String(raw).trim().length === 0) continue;
		const host = extractHost(raw);
		if (host === null) {
			return {
				action: "block",
				code: "invalid-url",
				reason: `无法解析目标地址 ${raw}；域名白名单开启时只允许 http(s) 地址。`,
			};
		}
		if (!matchesAllowedDomain(host, config.allowedDomains)) {
			return {
				action: "block",
				code: "domain-not-allowed",
				reason: `${host} 不在浏览器操作插件的域名白名单内，已拦截。请告知用户：如确需访问，在「设置 → 插件 → 浏览器操作」里把该域名加入白名单后重试。`,
			};
		}
	}
	return { action: "allow" };
}

/** 把逗号/空白/换行分隔的白名单文本解析成规范化域名列表。与 renderer 侧同名函数保持一致。 */
export function parseAllowedDomains(raw) {
	return [
		...new Set(
			String(raw ?? "")
				.split(/[\s,;]+/)
				.map((part) => part.trim().toLowerCase())
				.filter((part) => part.length > 0),
		),
	];
}
