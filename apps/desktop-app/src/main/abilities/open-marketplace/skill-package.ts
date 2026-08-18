import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";

interface SkillFrontmatter {
	name?: string;
	description?: string;
	version?: string;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	return (first === '"' || first === "'") && first === last ? trimmed.slice(1, -1) : trimmed;
}

export function parseSkillFrontmatter(content: string): SkillFrontmatter {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const result: SkillFrontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		const field = line.match(/^(name|description|version):\s*(.*)$/);
		if (!field) continue;
		const value = unquote(field[2]);
		if (value) result[field[1] as keyof SkillFrontmatter] = value;
	}
	return result;
}

export function assertSafeSkillTree(rootDir: string): void {
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const fullPath = join(dir, name);
			const stat = lstatSync(fullPath);
			if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in open abilities: ${name}`);
			if (stat.isDirectory()) walk(fullPath);
			else if (!stat.isFile()) throw new Error(`Unsupported file in open ability: ${name}`);
		}
	};
	walk(rootDir);
}

export function validateSkillPackage(rootDir: string, ability: MarketplaceAbilityManifest): void {
	assertSafeSkillTree(rootDir);
	const skillMdPath = join(rootDir, "SKILL.md");
	let content: string;
	try {
		content = readFileSync(skillMdPath, "utf-8");
	} catch {
		throw new Error(`Open ability ${ability.type}:${ability.slug} is missing SKILL.md`);
	}
	const frontmatter = parseSkillFrontmatter(content);
	if (!frontmatter.name || !frontmatter.description) {
		throw new Error(`Open ability ${ability.type}:${ability.slug} has invalid SKILL.md frontmatter`);
	}
	if (frontmatter.name !== ability.slug) {
		throw new Error(`Open ability slug mismatch: catalog=${ability.slug}, package=${frontmatter.name}`);
	}
	if (frontmatter.version !== ability.version) {
		throw new Error(
			`Open ability version mismatch: ${ability.slug} catalog=${ability.version}, package=${frontmatter.version ?? "missing"}`,
		);
	}
}
