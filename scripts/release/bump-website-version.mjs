#!/usr/bin/env node

/**
 * 官网下载入口的版本号：`apps/desktop/package.json` 的 version 是事实源，
 * `website/` 里的 5 处副本由本脚本对齐。
 *
 * 为什么要有脚本：`index.html` 的下载链接指向 R2 直链 `app/v<version>/<产物名>`，
 * 漏改任何一行都会让官网挂出 404 的下载按钮；手工数「共 14 处」不可靠。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopVersion } from "./release-notes.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-\d+)?$/;
const DOWNLOAD_VERSION_PATTERN = /DOWNLOAD_VERSION = "([^"]+)"/;

/** 官网里所有带版本号的文件：链接与标签、下载常量、包版本、两个测试的期望值。 */
export const WEBSITE_VERSION_FILES = [
	"website/index.html",
	"website/src/download-links.ts",
	"website/package.json",
	"website/test/download-target.test.ts",
	"website/test/download-entry.test.ts",
];

/** 除首页外的四个文件都有一个明确的版本字段，改前逐一对账，不靠全文替换碰运气。 */
const VERSION_FIELDS = {
	"website/src/download-links.ts": DOWNLOAD_VERSION_PATTERN,
	"website/package.json": /"version": "([^"]+)"/,
	"website/test/download-target.test.ts": /const VERSION = "([^"]+)"/,
	"website/test/download-entry.test.ts": /const VERSION = "([^"]+)"/,
};

/**
 * 首页没有单一字段：下载链接与版本标签都写成 `v<版本>`，按这个形状扫描。
 * 不能扫裸版本号——内联 SVG 的 path 数据里全是 `2.01.37` 这类坐标。
 */
const VERSION_LITERAL_PATTERN = /v(\d+\.\d+\.\d+(?:-\d+)?)/g;

function assertVersion(version) {
	if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
		throw new Error(`Invalid website version: ${String(version)}`);
	}
}

/** 官网当前对外宣称的版本，取自 `src/download-links.ts` 的 `DOWNLOAD_VERSION`。 */
export function readWebsiteVersion(root = repositoryRoot) {
	const source = readFileSync(join(root, "website/src/download-links.ts"), "utf8");
	const match = source.match(DOWNLOAD_VERSION_PATTERN);
	if (!match) throw new Error("Could not read DOWNLOAD_VERSION from website/src/download-links.ts");
	return match[1];
}

/**
 * 把官网 5 个文件的版本号从当前值改成 `version`，返回被改写的文件。
 * 已经在目标版本时返回空的 `files`，重复调用安全（流水线重跑不会产生空提交）。
 */
export function bumpWebsiteVersion({ version, root = repositoryRoot }) {
	assertVersion(version);
	const current = readWebsiteVersion(root);
	if (current === version) return { current, changed: false, files: [] };

	const files = [];
	for (const file of WEBSITE_VERSION_FILES) {
		const path = join(root, file);
		const contents = readFileSync(path, "utf8");
		const fields = VERSION_FIELDS[file];
		if (fields) {
			const found = contents.match(fields);
			if (!found) throw new Error(`Could not read the version field of ${file}`);
			if (found[1] !== current) {
				throw new Error(`${file} is at ${found[1]}, but the website downloads ${current}`);
			}
		} else {
			// 「0.5.64」是「0.5.64-4」的前缀：出现别的版本号就说明官网同时引用了多个版本，
			// 直接替换会把别人的版本号改坏，停下来让人判断。
			const others = [
				...new Set([...contents.matchAll(VERSION_LITERAL_PATTERN)].map((match) => match[1])),
			].filter((token) => token !== current);
			if (others.length > 0) {
				throw new Error(`${file} references other versions (${others.join(", ")}); bump it by hand`);
			}
		}
		if (!contents.includes(current)) {
			throw new Error(`${file} does not mention the current website version ${current}; files drifted apart`);
		}
		const next = contents.split(current).join(version);
		if (!next.includes(version)) throw new Error(`Could not apply ${version} to ${file}`);
		writeFileSync(path, next);
		files.push(file);
	}
	return { current, changed: true, files };
}

function main(argv) {
	const versionIndex = argv.indexOf("--version");
	const version = versionIndex === -1 ? desktopVersion() : argv[versionIndex + 1];
	if (!version) throw new Error("--version requires a value");
	if (argv.includes("--check")) {
		const current = readWebsiteVersion();
		if (current !== version) {
			throw new Error(`website download version is ${current}, expected ${version}`);
		}
		console.log(`Website download version matches ${version}.`);
		return;
	}
	const result = bumpWebsiteVersion({ version });
	if (!result.changed) {
		console.log(`Website download version is already ${version}.`);
		return;
	}
	console.log(`Website download version: ${result.current} → ${version}`);
	for (const file of result.files) console.log(`  ${file}`);
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
		process.exitCode = 1;
	}
}

