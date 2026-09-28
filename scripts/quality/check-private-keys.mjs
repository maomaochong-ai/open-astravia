/**
 * Fail if committed/staged sources look like they contain private keys.
 * Inspired by pre-commit detect-private-key; scoped to text-ish sources.
 *
 * Usage:
 *   bun run scripts/quality/check-private-keys.mjs
 *   bun run scripts/quality/check-private-keys.mjs --staged
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, isBinaryLike, isDirectRun, ok, readText, rel, repoRoot, stagedFiles, walkFiles } from "./lib.mjs";

// Build markers at runtime so this file is not flagged by its own patterns.
const begin = "-----BEGIN ";
const endKey = "PRIVATE KEY-----";
const PATTERNS = [
	{ name: "RSA private key", re: new RegExp(`${begin}RSA ${endKey}`) },
	{ name: "OPENSSH private key", re: new RegExp(`${begin}OPENSSH ${endKey}`) },
	{ name: "EC private key", re: new RegExp(`${begin}EC ${endKey}`) },
	{ name: "DSA private key", re: new RegExp(`${begin}DSA ${endKey}`) },
	{ name: "PGP private key block", re: new RegExp(`${begin}PGP PRIVATE KEY BLOCK-----`) },
	{ name: "generic PRIVATE KEY block", re: new RegExp(`${begin}([A-Z0-9 ]+)?${endKey}`) },
];

const SKIP_DIR_PARTS = [
	"/node_modules/",
	"/dist/",
	"/.git/",
	"/.next/",
	"/coverage/",
	"/releases/",
	"/scripts/quality/",
	// intentional fixtures / docs that may show key-shaped examples
	"/test/fixtures/",
	"/docs/",
];

function shouldSkip(posixPath) {
	const p = `/${posixPath.replaceAll("\\", "/")}`;
	if (p.endsWith("/check-private-keys.mjs")) return true;
	return SKIP_DIR_PARTS.some((part) => p.includes(part));
}

export function collectTargets({ stagedOnly = false, files = [] } = {}) {
	if (stagedOnly) {
		return stagedFiles()
			.map((f) => join(repoRoot, f))
			.filter((f) => existsSync(f) && !isBinaryLike(f) && !shouldSkip(rel(f)));
	}
	if (files.length > 0) {
		return files
			.map((file) => join(repoRoot, file))
			.filter((file) => existsSync(file) && !isBinaryLike(file) && !shouldSkip(rel(file)));
	}
	const roots = ["packages", "apps", "scripts", "deploy"].map((d) => join(repoRoot, d));
	const targets = [];
	for (const root of roots) {
		targets.push(
			...walkFiles(root, {
				extensions: [
					".ts",
					".tsx",
					".js",
					".mjs",
					".cjs",
					".json",
					".yml",
					".yaml",
					".env",
					".toml",
					".md",
					".sh",
					".ps1",
					".go",
				],
			}),
		);
	}
	return targets.filter((f) => !shouldSkip(rel(f)) && !isBinaryLike(f));
}

export function main(args = process.argv.slice(2)) {
	const stagedOnly = args.includes("--staged");
	const files = args.filter((arg) => arg !== "--staged");
	const targets = collectTargets({ stagedOnly, files });
	let hits = 0;

	for (const file of targets) {
		let text;
		try {
			text = readText(file);
		} catch {
			continue;
		}
		if (text.length > 2_000_000) continue;
		for (const { name, re } of PATTERNS) {
			if (re.test(text)) {
				hits += 1;
				fail(`[private-key] ${rel(file)}: possible ${name}`);
				break;
			}
		}
	}

	if (hits === 0) {
		const scope = stagedOnly ? ", staged" : files.length > 0 ? ", selected" : "";
		ok(`[private-key] ok (${targets.length} file(s)${scope})`);
		return 0;
	}
	fail(`[private-key] ${hits} file(s) failed`);
	return 1;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
