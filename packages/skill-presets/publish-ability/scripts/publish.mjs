#!/usr/bin/env node
/**
 * 把一个本地能力包提交到 Vetta 能力市场。
 *
 * 为什么是脚本而不是 MCP 工具：内建 vetta MCP 是**远程**服务，跑在服务端，摸不到
 * 用户磁盘上的 .zip / .tar.gz。上传天生是本地动作，所以它走 skill 内置脚本——
 * 脚本由 agent 在用户机器上执行，读文件、组 multipart、直接打服务端接口。
 *
 * 零外部依赖，只用 node 内置模块：skill 目录不是 npm 包，没有 node_modules 落脚点，
 * 而且内网/离线环境下任何 npm install 都会让这条路径直接不可用。
 * fetch / FormData / Blob 在 node 18+ 都是全局的。
 *
 * 用法：
 *   node publish.mjs --input payload.json
 *   cat payload.json | node publish.mjs
 *
 * 入参走文件或 stdin 而非命令行 flag：detail.content 是多行 markdown，含反引号、
 * 引号、$ 与换行，塞进命令行必被 shell 吃掉。
 *
 * 输出：stdout 一段 JSON；成功 exit 0，失败 exit 1。
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { apiUrl, loadCredentials } from "./auth.mjs";
import { inspectPackage } from "./package-inspect.mjs";
import { ARTIFACT_TYPES, crossCheckPackage, validateUploadInput } from "./validate.mjs";

function parseArgs(argv) {
	const args = { input: undefined, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--input" || arg === "-i") {
			args.input = argv[++i];
		} else if (arg.startsWith("--input=")) {
			args.input = arg.slice("--input=".length);
		} else if (arg === "--dry-run") {
			// 只跑本地校验、不发请求。写完 payload 先自查一遍，省一次网络往返。
			args.dryRun = true;
		}
	}
	return args;
}

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

function fail(message, extra = {}) {
	process.stdout.write(`${JSON.stringify({ ok: false, message, ...extra }, null, 2)}\n`);
	process.exit(1);
}

function succeed(payload) {
	process.stdout.write(`${JSON.stringify({ ok: true, ...payload }, null, 2)}\n`);
	process.exit(0);
}

/**
 * 成功文案要说清「现在能不能被别人看到」——这是提交者唯一真正关心的事。
 * 三种结局：待审、已上架、以及线上版仍在服役但新版本待审。
 */
function buildSuccessMessage(reviewStatus, hasPending) {
	if (hasPending) {
		return "提交成功。这是已上架条目的新版本，正在等待管理员审核；审核通过前市场上仍展示当前线上版本，用户不受影响。";
	}
	if (reviewStatus === "approved") {
		return "提交成功，已上架，市场中立即可见。";
	}
	return "提交成功，正在等待管理员审核。审核通过后才会出现在能力市场中，可用内建 vetta MCP 的 list_my_abilities 查看进度与驳回理由。";
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	const rawInput = args.input ? readFileSync(args.input, "utf8") : await readStdin();
	if (!rawInput.trim()) {
		fail("没有读到任何入参。用 --input <payload.json> 指定文件，或从 stdin 传入 JSON。");
	}

	let input;
	try {
		input = JSON.parse(rawInput);
	} catch (error) {
		fail(`入参不是合法 JSON：${error.message}`);
	}

	// 一次列全所有问题，agent 一轮就能补齐重试
	const errors = validateUploadInput(input, { packageExists: existsSync });

	// 再拿安装包核对一遍：payload 与包内 manifest 的口径分歧（尤其是 i18n 的 locale 键）
	// 服务端不会报错，只会按优先级让一边沉底，装完切语言才看得见。见 validate.mjs 的说明。
	let warnings = [];
	if (errors.length === 0 && ARTIFACT_TYPES.includes(input.type) && existsSync(input.package_path)) {
		const crossCheck = crossCheckPackage(input, inspectPackage(input.package_path));
		errors.push(...crossCheck.errors);
		warnings = crossCheck.warnings;
	}

	if (errors.length > 0) {
		fail(`提交被拒绝，请修正以下 ${errors.length} 处后重试：\n${errors.map((e) => `- ${e}`).join("\n")}`, {
			errors,
		});
	}

	if (args.dryRun) {
		succeed({ message: "本地校验通过（--dry-run，未提交）。", dry_run: true, warnings });
	}

	const credentials = loadCredentials();
	if (!credentials) {
		fail("未登录：读不到 ~/.vetta/auth.json。请先在 Vetta 客户端登录后重试。");
	}

	const form = new FormData();
	form.set("type", input.type);
	form.set("detail", JSON.stringify(input.detail));
	if (input.slug?.trim()) form.set("slug", input.slug.trim());
	if (input.version?.trim()) form.set("version", input.version.trim());
	if (input.category?.trim()) form.set("category", input.category.trim());
	// tags 只走 detail：平铺的 tags 表单字段是 admin 通道的入参，skill/scene 的上传路径
	// 压根不读它，plugin 与 mcp/bundle 读了也会被 detail.tags 再覆盖一遍。
	// 同一份数据发两遍、三种优先级，只会制造「改了没生效」的假象。

	if (input.type === "mcp") {
		form.set("config", JSON.stringify(input.mcp_config ?? {}));
	} else if (input.type === "bundle") {
		form.set("config", JSON.stringify({ members: input.members ?? [] }));
	}

	if (ARTIFACT_TYPES.includes(input.type)) {
		const bytes = readFileSync(input.package_path);
		// Blob 需要 ArrayBuffer 视图；Buffer 本身是 Uint8Array 的子类
		form.set("file", new Blob([new Uint8Array(bytes)]), basename(input.package_path));
	}

	let response;
	try {
		response = await fetch(apiUrl(credentials.baseUrl, "/abilities/submit"), {
			method: "POST",
			headers: { Authorization: `Bearer ${credentials.token}` },
			body: form,
		});
	} catch (error) {
		fail(`无法连接 Vetta 服务（${credentials.baseUrl}）：${error.message}`);
	}

	const text = await response.text();
	let payload = {};
	try {
		payload = text ? JSON.parse(text) : {};
	} catch {
		// 网关错误页之类的非 JSON 响应，原样截断回显比吞掉更有助于定位
		fail(`服务端返回了非预期内容（HTTP ${response.status}）：${text.slice(0, 300)}`);
	}

	if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
		fail(`提交失败：${payload.message?.trim() || `HTTP ${response.status}`}`);
	}

	const data = payload.data ?? {};
	const hasPending = Boolean(data.pending);
	succeed({
		message: buildSuccessMessage(data.review_status, hasPending),
		// 提交成功但仍有值得复述给用户的口径分歧（如包内译文被 payload 覆盖）
		warnings,
		slug: data.slug,
		type: data.type,
		version: data.version,
		review_status: data.review_status,
		has_pending: hasPending,
	});
}

main().catch((error) => {
	fail(`脚本执行失败：${error?.stack ?? error?.message ?? String(error)}`);
});
