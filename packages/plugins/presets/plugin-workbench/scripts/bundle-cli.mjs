#!/usr/bin/env node
/**
 * Bundle the published plugin CLI into this package.
 *
 * 取代原先的 sync-plugin-docs.mjs：工作台不再自带一份手册副本。手册随
 * `@vetta-org/plugin-sdk` 进插件工程自己的 node_modules，由 CLI 的 `docs` 命令解析——
 * 那份才与被编辑工程实际编译的 SDK 版本一致，而随 App 发版的内嵌副本做不到。
 *
 * 内置而不是 `npx`：工作台是系统插件，随 App 发版，内置让版本关系确定，也不受首次拉包的
 * 网络状况影响。产物是单文件、零运行时依赖，直接 `node` 执行即可。
 */
import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(pluginRoot, "agent", "cli");
const destFile = join(destDir, "vetta-plugin-cli.js");
const sourceFile = process.env.VETTA_PLUGIN_CLI_DIST
	? resolve(process.env.VETTA_PLUGIN_CLI_DIST)
	: resolve(pluginRoot, "../../plugin-cli/dist/cli.js");

async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

if (!(await isFile(sourceFile))) {
	// 仓库外（只拿到打包产物）时保留已内置的副本；构建链断了要能看出来，所以说清原因。
	console.log(JSON.stringify({ ok: true, skipped: true, reason: `source missing: ${sourceFile}` }));
	process.exit(0);
}

await mkdir(destDir, { recursive: true });
await copyFile(sourceFile, destFile);
await chmod(destFile, 0o755);

const { size } = await stat(destFile);
console.log(JSON.stringify({ ok: true, skipped: false, destFile, bytes: size }));
