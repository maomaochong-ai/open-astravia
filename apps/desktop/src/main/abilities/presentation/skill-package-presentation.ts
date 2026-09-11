import { readFileSync, statSync } from "node:fs";
import { parse } from "yaml";
import { extractFrontmatter } from "../../skills/skill-frontmatter.js";
import {
	createLocalPresentationAssetUrl,
	type PresentationAssetUrlResolver,
	resolvePresentationImageReference,
} from "../open-marketplace/open-marketplace-presentation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 通用 Skill 规范没有图标字段。Vetta 的产品呈现扩展因此放在 namespaced metadata 下，
 * 不改变 Skill 的运行时身份或调用语义。
 */
export function readDeclaredSkillIconReference(content: string): string | undefined {
	const frontmatter = extractFrontmatter(content);
	if (!frontmatter) return undefined;
	const parsed: unknown = parse(frontmatter);
	if (!isRecord(parsed) || !isRecord(parsed.metadata)) return undefined;
	const vetta = parsed.metadata.vetta;
	if (!isRecord(vetta) || !isRecord(vetta.presentation)) return undefined;
	const icon = vetta.presentation.icon;
	return typeof icon === "string" && icon.trim() ? icon.trim() : undefined;
}

export function loadSkillPackagePresentationIcon(input: {
	readonly filePath: string;
	readonly baseDir: string;
	readonly assetUrlResolver?: PresentationAssetUrlResolver;
}): string | undefined {
	const reference = readDeclaredSkillIconReference(readFileSync(input.filePath, "utf-8"));
	if (!reference) return undefined;
	const revision = Math.trunc(statSync(input.filePath).mtimeMs).toString(36);
	const resolver =
		input.assetUrlResolver ?? ((absolutePath: string) => createLocalPresentationAssetUrl(absolutePath, revision));
	return resolvePresentationImageReference(input.baseDir, reference, resolver, true);
}
