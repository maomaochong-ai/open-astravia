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
import { fail, isBinaryLike, ok, readText, rel, repoRoot, stagedFiles, walkFiles } from "./lib.mjs";

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

function collectTargets(stagedOnly) {
	if (stagedOnly) {
		return stagedFiles()
			.map((f) => join(repoRoot, f))
			.filter((f) => existsSync(f) && !isBinaryLike(f) && !shouldSkip(rel(f)));
	}
	const roots = ["packages", "apps", "scripts", "deploy"].map((d) => join(repoRoot, d));
	const files = [];
	for (const root of roots) {
		files.push(
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
	return files.filter((f) => !shouldSkip(rel(f)) && !isBinaryLike(f));
}

const stagedOnly = process.argv.includes("--staged");
const targets = collectTargets(stagedOnly);
let hits = 0;

for (const file of targets) {
	let text;
	try {
		text = readText(file);
	} catch {
		continue;
	}
	// skip huge files
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
	ok(`[private-key] ok (${targets.length} file(s)${stagedOnly ? ", staged" : ""})`);
} else {
	fail(`[private-key] ${hits} file(s) failed`);
	process.exit(1);
}
