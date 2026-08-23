/**
 * 开源版硬约束：仓库内不得出现任何指向 Astravia 服务端的耦合。
 *
 * 本版本是商业版的永久硬分叉——登录体系、Astravia Go 计费网关、能力市场服务端、
 * 站内信推送、遥测上报全部物理删除。删除容易，**不再长回来**难：后续从商业版
 * cherry-pick 代码时，一个 `fetch(serverUrl)` 混进来不会有任何编译错误，只会在
 * 用户机器上悄悄发出一次请求。这条守卫就是那道闸。
 *
 * 判定口径：纯文本模式匹配，不做语义分析。宁可误报（加白名单成本很低），
 * 也不放过——漏一个的代价是开源版偷偷回连厂商服务器。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Windows 下 URL.pathname 会带前导斜杠（/E:/...），fs 无法识别，必须转回真实路径。
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");

/** 不扫描的目录：依赖、构建产物、版本库自身。 */
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"release",
	"releases",
	"out",
	".artifacts",
	"coverage",
	".next",
	"vendor",
]);

/** 只扫文本源码与配置；二进制与锁文件无意义。 */
const SCAN_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".go",
	".json",
	".jsonc",
	".yml",
	".yaml",
	".sh",
	".md",
	".env",
	".example",
]);

/**
 * 禁止出现的模式。message 要能直接告诉人「该怎么办」，而不只是「你违规了」。
 */
const FORBIDDEN = [
	{
		id: "vendor-domain",
		pattern: /openastravia\.com/i,
		message: "指向厂商服务端/门户/更新源的域名。开源版不连任何 Astravia 托管服务。",
	},
	{
		id: "server-url-env",
		pattern: /ASTRAVIA_SERVER_URL|ASTRAVIA_SITE_URL|ASTRAVIA_API_BASE_URL|ASTRAVIA_API_TOKEN/,
		message: "服务端地址/凭据的构建期注入。开源版没有服务端，模型一律 BYOK（见 ADR-0050）。",
	},
	{
		id: "server-credentials",
		pattern: /serverToken|serverRefreshToken|setServerUrl|loadRemoteModels|reloadServerAuth/,
		message: "登录态或远程模型目录的残留。开源版无登录，ModelRegistry 只读本地 models.json。",
	},
	{
		id: "credential-file",
		pattern: /~\/\.astravia\/auth\.json|astravia\/auth\.json/,
		message: "客户端登录凭据下沉文件。该契约随登录体系一并删除。",
	},
	{
		id: "api-prefix",
		pattern: /\/api\/v1\//,
		message: "Astravia 业务 API 路径。开源版不调用任何业务后端。",
	},
	{
		id: "private-host",
		pattern: /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
		message: "内网地址。不得把公司内网主机写进开源仓库。",
	},
	{
		id: "commercial-telemetry",
		pattern: /ASTRAVIA_SENTRY|ASTRAVIA_POSTHOG|@sentry\/electron|posthog-js/,
		message: "遥测上报。开源版不向任何第三方回传使用数据。",
	},
	{
		id: "billing",
		pattern: /astravia-go|AstraviaGo|subscription\/me|credit_base|GoUsageWindow/,
		message: "Astravia Go 订阅计费。整套计费模型属商业版。",
	},
];

/**
 * 白名单：路径前缀 → 允许命中的规则 id 集合（`*` 表示整份文件豁免）。
 *
 * 只给两类东西开口子：① 本守卫自身（它必须写出这些模式才能匹配）；
 * ② 文档里说明「此处曾有什么、为何移除」的墓碑。代码永远不进白名单。
 */
const ALLOWLIST = [
	{ prefix: "scripts/quality/check-no-astravia-api.mjs", rules: "*" },
	{ prefix: "scripts/quality/quality-gates.test.mjs", rules: "*" },

	// 历史决策记录与变更日志：允许描述「曾经有什么、为何移除」。
	// 这些是墓碑，不是活代码——读者需要知道被删掉的是什么。
	{ prefix: "docs/adr/", rules: "*" },
	{ prefix: "CONTEXT.md", rules: "*" },
	{ prefix: "packages/desktop-app/CHANGELOG.md", rules: "*" },
	{ prefix: "packages/coding-agent/CHANGELOG.md", rules: "*" },
	{ prefix: "packages/ai/CHANGELOG.md", rules: "*" },

	// README 的官网 badge 与「详细教程见官网」：是给读者看的文档链接，
	// 不是客户端会去请求的端点。只放行 vendor-domain，真出现服务端地址或凭据仍然拦。
	{ prefix: "README.md", rules: ["vendor-domain"] },
	{ prefix: "README.en-US.md", rules: ["vendor-domain"] },

	// macOS 本地网络隐私（LNP）探测：必须真的去连 RFC1918 地址才能判断授权状态。
	// 这些常量是探测目标，不是任何服务器。
	{ prefix: "packages/desktop-app/src/main/diagnostics.ts", rules: ["private-host"] },

	// 卸载旧版本遗留的登录键。要删掉它们就必须写出键名。
	{ prefix: "packages/desktop-app/src/main/ipc/settings.ts", rules: ["server-credentials"] },

	// 第三方服务商（Qwen）自己的 OAuth 端点，与 Astravia 后端无关。
	{
		prefix: "packages/coding-agent/examples/extensions/custom-provider-qwen-cli/",
		rules: ["api-prefix"],
	},
];

function allowedRules(relPath) {
	const normalized = relPath.split(sep).join("/");
	for (const entry of ALLOWLIST) {
		if (normalized === entry.prefix || normalized.startsWith(entry.prefix)) {
			return entry.rules;
		}
	}
	return null;
}

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const full = join(dir, name);
		let stats;
		try {
			stats = statSync(full);
		} catch {
			continue;
		}
		if (stats.isDirectory()) {
			yield* walk(full);
		} else if (stats.isFile()) {
			yield full;
		}
	}
}

function shouldScan(path) {
	const ext = extname(path);
	if (SCAN_EXTENSIONS.has(ext)) return true;
	// .env / .env.production 之类没有常规扩展名
	return /(^|\/)\.env(\.|$)/.test(path.split(sep).join("/"));
}

const violations = [];
let scanned = 0;

for (const path of walk(ROOT)) {
	if (!shouldScan(path)) continue;
	const relPath = relative(ROOT, path);
	const allowed = allowedRules(relPath);
	if (allowed === "*") continue;

	let content;
	try {
		content = readFileSync(path, "utf8");
	} catch {
		continue;
	}
	scanned += 1;

	const lines = content.split("\n");
	for (const rule of FORBIDDEN) {
		if (Array.isArray(allowed) && allowed.includes(rule.id)) continue;
		for (let i = 0; i < lines.length; i += 1) {
			if (rule.pattern.test(lines[i])) {
				violations.push({
					file: relPath,
					line: i + 1,
					rule: rule.id,
					message: rule.message,
					text: lines[i].trim().slice(0, 120),
				});
			}
		}
	}
}

if (violations.length > 0) {
	console.error(`[no-astravia-api] 发现 ${violations.length} 处服务端耦合残留：\n`);
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
		console.error(`    ${v.text}`);
		console.error(`    → ${v.message}\n`);
	}
	console.error("如确属误报，在 check-no-astravia-api.mjs 的 ALLOWLIST 里登记，并写清为什么它不是真的耦合。");
	process.exit(1);
}

console.log(`[no-astravia-api] ok (${scanned} file(s) scanned)`);
