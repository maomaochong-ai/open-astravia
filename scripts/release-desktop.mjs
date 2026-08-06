#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DESKTOP_PACKAGE_PATH = "packages/desktop-app/package.json";
const DESKTOP_CHANGELOG_PATH = "packages/desktop-app/CHANGELOG.md";
const LOCKFILE_PATH = "bun.lock";
const RELEASE_FILES = [DESKTOP_PACKAGE_PATH, DESKTOP_CHANGELOG_PATH, LOCKFILE_PATH];
const bumpType = process.argv[2];

if (bumpType !== "patch" && bumpType !== "minor") {
	console.error("Usage: node scripts/release-desktop.mjs <patch|minor>");
	process.exit(1);
}

function run(command, args, options = {}) {
	console.log(`$ ${command} ${args.join(" ")}`);
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
		...options,
	});
}

function readDesktopPackage() {
	return JSON.parse(readFileSync(DESKTOP_PACKAGE_PATH, "utf8"));
}

function bumpVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`Invalid desktop version: ${version}`);

	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	return bumpType === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

function updateChangelog(version) {
	const changelog = readFileSync(DESKTOP_CHANGELOG_PATH, "utf8");
	const unreleasedHeading = /^## \[Unreleased\].*$/m;
	if (!unreleasedHeading.test(changelog)) {
		throw new Error(`${DESKTOP_CHANGELOG_PATH} is missing an [Unreleased] section`);
	}

	const date = new Date().toISOString().slice(0, 10);
	const releasedHeading = `## [${version}] - ${date}`;
	const updated = changelog.replace(unreleasedHeading, `## [Unreleased]\n\n${releasedHeading}`);
	writeFileSync(DESKTOP_CHANGELOG_PATH, updated);
}

function assertCleanWorktree() {
	const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
	if (status) throw new Error(`Uncommitted changes detected:\n${status}`);
}

function assertBranch() {
	const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
	if (!branch) throw new Error("Desktop release must run on a branch, not a detached HEAD");
	return branch;
}

function assertTagAvailable(tag) {
	try {
		run("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], { capture: true });
		throw new Error(`Tag already exists locally: ${tag}`);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Tag already exists")) throw error;
	}

	try {
		run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], { capture: true });
		throw new Error(`Tag already exists on origin: ${tag}`);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Tag already exists")) throw error;
	}
}

function assertOnlyReleaseFilesChanged() {
	const changedFiles = run("git", ["status", "--porcelain"], { capture: true })
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => line.slice(3).replaceAll("\\", "/"));
	const allowedFiles = new Set(RELEASE_FILES);
	const unexpectedFiles = changedFiles.filter((file) => !allowedFiles.has(file));
	if (unexpectedFiles.length > 0) {
		throw new Error(`Desktop release changed unexpected files:\n${unexpectedFiles.join("\n")}`);
	}
}

assertCleanWorktree();
const branch = assertBranch();
run("bun", ["run", "check:lint"]);
run("bun", ["run", "--cwd", "packages/desktop-app", "typecheck"]);
run("bun", ["run", "check:guards"]);
assertCleanWorktree();

const desktopPackage = readDesktopPackage();
const version = bumpVersion(desktopPackage.version);
const tag = `v${version}`;
assertTagAvailable(tag);

desktopPackage.version = version;
writeFileSync(DESKTOP_PACKAGE_PATH, `${JSON.stringify(desktopPackage, null, "\t")}\n`);
updateChangelog(version);
run("bun", ["install", "--lockfile-only"]);
assertOnlyReleaseFilesChanged();

run("git", ["add", "--", ...RELEASE_FILES]);
run("git", ["commit", "-m", `release(desktop): 发布 ${tag}`]);
run("git", ["tag", tag]);
run("git", ["push", "--atomic", "origin", branch, `refs/tags/${tag}`]);

console.log(`Desktop ${tag} 已推送，等待 desktop-release 工作流完成。`);
