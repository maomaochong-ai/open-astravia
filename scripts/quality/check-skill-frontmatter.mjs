/**
 * Guard SKILL.md frontmatter against the mistakes that make a skill vanish.
 *
 * Why a guard and not just care: frontmatter is parsed with a real YAML parser
 * (packages/coding-agent/src/utils/frontmatter.ts). When it throws, nothing the
 * author can see reports it — the loader drops the skill, and it silently
 * disappears from the agent's skill list and the slash menu. The description is
 * long prose written by hand, so the usual break is plain YAML syntax: an
 * unquoted scalar containing ": " parses as a nested mapping and errors out.
 *
 * This does NOT re-implement YAML (guards stay dependency-free, see lib.mjs).
 * It checks the shape skills actually use — a flat block of `key: value` — and
 * rejects the unquoted-scalar hazards plus a missing/oversized description.
 *
 * Usage:
 *   bun run scripts/quality/check-skill-frontmatter.mjs
 *   bun run scripts/quality/check-skill-frontmatter.mjs --staged
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, stagedFiles } from "./lib.mjs";

/** Mirrors MAX_DESCRIPTION_LENGTH in packages/coding-agent/src/core/skills.ts. */
const MAX_DESCRIPTION_LENGTH = 1024;

const SCAN_ROOTS = ["packages", ".claude"];
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	".git",
	"release",
	"releases",
	"coverage",
	"out",
	"build",
	".turbo",
	".cache",
	// Build staging copies of system plugins — the sources are scanned already,
	// and a stale copy here would report the same file twice.
	".artifacts",
	// The loader's own tests need deliberately broken frontmatter to assert on.
	"fixtures",
]);

function findSkillFiles(dir, results = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			findSkillFiles(join(dir, entry.name), results);
			continue;
		}
		if (entry.name === "SKILL.md") results.push(join(dir, entry.name));
	}
	return results;
}

function collectTargets(stagedOnly) {
	if (stagedOnly) {
		return stagedFiles()
			.filter((file) => file.endsWith("SKILL.md"))
			.map((file) => join(repoRoot, file))
			.filter((file) => existsSync(file));
	}
	const results = [];
	for (const root of SCAN_ROOTS) findSkillFiles(join(repoRoot, root), results);
	return results;
}

/** Same extraction as packages/coding-agent/src/utils/frontmatter.ts. */
function frontmatterOf(text) {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return null;
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return null;
	return normalized.slice(4, end);
}

function isQuoted(value) {
	return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
}

/** `description: >` / `|-` … — the value is the indented block that follows. */
function isBlockScalar(value) {
	return /^[|>][+-]?\d*$/.test(value);
}

/** Unquoted plain scalars where YAML would choke or silently truncate. */
function scalarHazard(value) {
	if (value.includes(": ")) return 'contains ": " — YAML reads it as a nested mapping and fails to parse';
	if (value.endsWith(":")) return 'ends with ":" — YAML reads it as a nested mapping and fails to parse';
	if (/\s#/.test(value)) return 'contains " #" — YAML truncates the rest as a comment';
	if (/^[[{*&!%@`]/.test(value)) return `starts with "${value[0]}" — reserved YAML indicator`;
	return null;
}

/** Human-readable problems with one SKILL.md's frontmatter; empty = fine. */
export function findSkillFrontmatterProblems(text) {
	const problems = [];
	const yamlString = frontmatterOf(text);
	if (yamlString === null) return ["missing or unterminated --- frontmatter block"];

	const values = new Map();
	const lines = yamlString.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		// Only top-level `key: value` lines are validated; indented blocks,
		// list items, comments and blanks are left to the real parser.
		if (line.trim() === "" || line.startsWith("#") || /^\s/.test(line) || line.startsWith("-")) continue;
		const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!match) {
			problems.push(`line ${index + 2}: not a \`key: value\` entry — ${JSON.stringify(line.slice(0, 60))}`);
			continue;
		}
		const [, key, rawValue] = match;
		const value = rawValue.trim();
		if (isBlockScalar(value)) {
			// Folded/literal block: the value is every indented line below it.
			const block = [];
			while (index + 1 < lines.length && (lines[index + 1].trim() === "" || /^\s/.test(lines[index + 1]))) {
				index += 1;
				block.push(lines[index].trim());
			}
			values.set(key, block.join(" ").trim());
			continue;
		}
		if (isQuoted(value)) {
			values.set(key, value.slice(1, -1));
			continue;
		}
		values.set(key, value);
		if (value === "") continue;
		const hazard = scalarHazard(value);
		if (hazard) problems.push(`line ${index + 2}: \`${key}\` ${hazard} (wrap the value in double quotes)`);
	}

	const description = values.get("description");
	if (description === undefined || description === "") {
		problems.push("description is required — it is the only text the model sees before invoking the skill");
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		problems.push(`description is ${description.length} chars (max ${MAX_DESCRIPTION_LENGTH})`);
	}
	return problems;
}

if (isDirectRun(import.meta.url)) {
	const stagedOnly = process.argv.includes("--staged");
	const targets = collectTargets(stagedOnly);
	let hits = 0;

	for (const file of targets) {
		const problems = findSkillFrontmatterProblems(readText(file));
		if (problems.length === 0) continue;
		hits += 1;
		for (const problem of problems) fail(`[skill-frontmatter] ${rel(file)}: ${problem}`);
	}

	if (hits === 0) {
		ok(`[skill-frontmatter] ok (${targets.length} file(s)${stagedOnly ? ", staged" : ""})`);
	} else {
		fail(`[skill-frontmatter] ${hits} file(s) failed`);
		process.exit(1);
	}
}
