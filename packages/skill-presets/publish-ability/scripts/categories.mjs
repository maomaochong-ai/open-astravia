#!/usr/bin/env node
/**
 * 列出能力市场当前可用的分类。
 *
 * 存在的理由：提交时 `category` 只能按**名字**给（分类 id 是后台的自增主键，
 * 提交者拿不到也不该关心），而名字对不上时服务端不会报错，只会静默落进未分类——
 * 一个查不到清单的必填口径，等于让作者猜。
 *
 * 与 publish.mjs 同为本地脚本、共用 auth.mjs 的凭据契约。
 *
 * 用法：
 *   node categories.mjs            # 人读：一行一个分类
 *   node categories.mjs --json     # 机读：{"ok":true,"categories":[...]}
 *
 * 输出：exit 0 成功，1 失败。
 */

import { apiUrl, loadCredentials } from "./auth.mjs";

function fail(message) {
	process.stdout.write(`${JSON.stringify({ ok: false, message }, null, 2)}\n`);
	process.exit(1);
}

async function main() {
	const asJson = process.argv.slice(2).includes("--json");

	const credentials = loadCredentials();
	if (!credentials) {
		fail("未登录：读不到 ~/.vetta/auth.json。请先在 Vetta 客户端登录后重试。");
	}

	let response;
	try {
		response = await fetch(apiUrl(credentials.baseUrl, "/ability-categories"), {
			headers: { Authorization: `Bearer ${credentials.token}` },
		});
	} catch (error) {
		fail(`无法连接 Vetta 服务（${credentials.baseUrl}）：${error.message}`);
	}

	const text = await response.text();
	let payload = {};
	try {
		payload = text ? JSON.parse(text) : {};
	} catch {
		fail(`服务端返回了非预期内容（HTTP ${response.status}）：${text.slice(0, 300)}`);
	}
	if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
		fail(`查询分类失败：${payload.message?.trim() || `HTTP ${response.status}`}`);
	}

	// name 是规范名，也是提交时要填进 payload.category 的那个值；i18n 只是展示译名
	const categories = (payload.data ?? []).map((c) => ({
		name: c.name,
		i18n: c.i18n ?? {},
		ability_count: c.ability_count ?? 0,
	}));

	if (asJson) {
		process.stdout.write(`${JSON.stringify({ ok: true, categories }, null, 2)}\n`);
		process.exit(0);
	}

	if (categories.length === 0) {
		process.stdout.write("（服务端没有配置任何分类，提交时省略 category 即可）\n");
		process.exit(0);
	}
	process.stdout.write("可用分类（把 name 原样填进 payload 的 category）：\n");
	for (const c of categories) {
		const translations = Object.entries(c.i18n)
			.map(([locale, value]) => `${locale}=${value}`)
			.join(" ");
		process.stdout.write(`- ${c.name}${translations ? `  [${translations}]` : ""}  (${c.ability_count})\n`);
	}
	process.exit(0);
}

main().catch((error) => {
	fail(`脚本执行失败：${error?.stack ?? error?.message ?? String(error)}`);
});
