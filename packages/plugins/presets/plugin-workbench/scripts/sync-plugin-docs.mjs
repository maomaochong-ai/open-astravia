#!/usr/bin/env node
/**
 * Sync monorepo docs/plugin → agent/docs/plugin so the agent can read the full
 * plugin handbook at runtime (production App does not ship the monorepo tree).
 *
 * Usage (from plugin root or any cwd):
 *   node scripts/sync-plugin-docs.mjs
 *
 * Looks for repo docs/plugin relative to this package (../../../../docs/plugin)
 * or VETTA_PLUGIN_DOCS_SRC env override.
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const destDir = join(pluginRoot, "agent", "docs", "plugin");

const defaultSrc = resolve(pluginRoot, "../../../../docs/plugin");
const srcDir = process.env.VETTA_PLUGIN_DOCS_SRC
	? resolve(process.env.VETTA_PLUGIN_DOCS_SRC)
	: defaultSrc;

async function main() {
	try {
		const st = await stat(srcDir);
		if (!st.isDirectory()) throw new Error("not a directory");
	} catch {
		// Outside monorepo (e.g. only zip installed): keep existing bundled docs.
		console.log(
			JSON.stringify({
				ok: true,
				skipped: true,
				reason: `source missing: ${srcDir}`,
				destDir,
			}),
		);
		return;
	}

	// Windows may report ENOTEMPTY while antivirus/indexing or another build
	// process briefly holds a file in the directory. Node retries this class of
	// transient filesystem errors when recursive removal is configured to do so.
	await rm(destDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	await mkdir(destDir, { recursive: true });
	await cp(srcDir, destDir, { recursive: true });

	const files = (await readdir(destDir)).filter((f) => f.endsWith(".md")).sort();
	const stamp = {
		source: srcDir,
		files,
	};
	await writeFile(join(destDir, ".sync-meta.json"), `${JSON.stringify(stamp, null, 2)}\n`, "utf8");

	console.log(JSON.stringify({ ok: true, skipped: false, destDir, fileCount: files.length, files }, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
