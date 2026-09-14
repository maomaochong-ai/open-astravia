#!/usr/bin/env node
/**
 * Copy the plugin manual into the package so it ships inside the npm tarball.
 *
 * 手册必须与 SDK 同版本发布。插件工程 `npm i @vetta-org/plugin-sdk@^0.3.0` 之后，
 * `node_modules/@vetta-org/plugin-sdk/docs/` 里就是 0.3.0 的手册——Agent 读到的合同
 * 与它即将编译的合同天然一致。从网络现取做不到这一点：main 上的手册会教 Agent 写出
 * 用户宿主还不支持的东西，而那种错误不会在构建期暴露。
 *
 * 仓库外（只有 tarball）时源目录不存在，保留包内已有副本并静默跳过。
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(packageRoot, "docs");
const srcDir = process.env.VETTA_PLUGIN_DOCS_SRC
	? resolve(process.env.VETTA_PLUGIN_DOCS_SRC)
	: resolve(packageRoot, "../../../docs/plugin");

async function isDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

if (!(await isDirectory(srcDir))) {
	console.log(JSON.stringify({ ok: true, skipped: true, reason: `source missing: ${srcDir}` }));
	process.exit(0);
}

await rm(destDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

const files = (await readdir(destDir)).filter((name) => name.endsWith(".md")).sort();
// 给读者一个稳定的入口说明：拿到 tarball 的人不一定知道这份目录是怎么来的。
await writeFile(
	join(destDir, ".source.json"),
	`${JSON.stringify({ source: "docs/plugin", files }, null, 2)}\n`,
	"utf8",
);

console.log(JSON.stringify({ ok: true, skipped: false, destDir, fileCount: files.length }));
