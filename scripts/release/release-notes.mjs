#!/usr/bin/env node

/**
 * 发布说明的唯一寻址入口：版本号 → `.github/release-notes/v<version>.md`。
 *
 * 发布流水线拿它做两件事：质量阶段校验文件存在（缺了就早早失败，而不是等到
 * 签名、公证、四个平台都跑完才发现没有 Release 正文），发布阶段解析出路径喂给
 * `gh release create --notes-file`。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE_NOTES_DIR = ".github/release-notes";

export function desktopVersion(root = repositoryRoot) {
	const manifest = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8"));
	const version = manifest.version;
	if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error(`Invalid desktop version in apps/desktop/package.json: ${String(version)}`);
	}
	return version;
}

export function releaseNotesPath(version) {
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
	return `${RELEASE_NOTES_DIR}/v${version}.md`;
}

export function releaseNotesMissingMessage(version) {
	return [
		`Missing release notes for v${version}: ${releaseNotesPath(version)}`,
		"每个版本都要有发布说明——它就是 GitHub Release 的正文。",
		`新建 ${releaseNotesPath(version)}，写法见 ${RELEASE_NOTES_DIR}/README.md。`,
	].join("\n");
}

/** 存在则返回相对仓库根的路径，缺失时抛出可直接给人看的说明。 */
export function requireReleaseNotes(version, root = repositoryRoot) {
	const path = releaseNotesPath(version);
	if (!existsSync(join(root, path))) throw new Error(releaseNotesMissingMessage(version));
	return path;
}

function main(argv) {
	const versionIndex = argv.indexOf("--version");
	const version = versionIndex === -1 ? desktopVersion() : argv[versionIndex + 1];
	if (!version) throw new Error("--version requires a value");
	const path = requireReleaseNotes(version);
	// --check 只做校验；默认打印路径，方便 shell 里直接代入 --notes-file。
	if (!argv.includes("--check")) console.log(path);
	else console.log(`Release notes found for v${version}: ${path}`);
}

function isExecutedDirectly() {
	const invoked = process.argv[1];
	if (!invoked) return false;
	return fileURLToPath(import.meta.url).toLowerCase() === resolve(invoked).toLowerCase();
}

if (isExecutedDirectly()) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
