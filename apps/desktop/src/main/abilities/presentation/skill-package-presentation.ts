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
 * 通用 Skill 规范没有图标字段。Astravia 的产品呈现扩展因此放在 namespaced metadata 下，
 * 不改变 Skill 的运行时身份或调用语义。
 */
export function readDeclaredSkillIconReference(content: string): string | undefined {
	const frontmatter = extractFrontmatter(content);
	if (!frontmatter) return undefined;
	const parsed: unknown = parse(frontmatter);
	if (!isRecord(parsed) || !isRecord(parsed.metadata)) return undefined;
	const astravia = parsed.metadata.astravia;
	if (!isRecord(astravia) || !isRecord(astravia.presentation)) return undefined;
	const icon = astravia.presentation.icon;
	return typeof icon === "string" && icon.trim() ? icon.trim() : undefined;
}

/**
 * 市场安装的技能包会在同目录的 `ability.json` 里声明 `icon`（SKILL.md frontmatter 没有
 * namespaced presentation 时用它）。
 *
 * 少了这一条，从市场装的技能在技能清单里没有图标——面板与 `/` 菜单只能显示默认图，
 * 而能力页因为能读市场行，是有图标的，两边看起来像「没识别出来」。只认包内相对路径，
 * 绝对路径与协议 URL 一律忽略（那是别的域的数据，不该从这里读）。
 */
function readAbilityJsonIconReference(baseDir: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(`${baseDir}/ability.json`, "utf-8"));
		if (!isRecord(parsed)) return undefined;
		const icon = parsed.icon;
		return typeof icon === "string" && icon.trim() ? icon.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function loadSkillPackagePresentationIcon(input: {
	readonly filePath: string;
	readonly baseDir: string;
	readonly assetUrlResolver?: PresentationAssetUrlResolver;
}): string | undefined {
	const reference =
		readDeclaredSkillIconReference(readFileSync(input.filePath, "utf-8")) ??
		readAbilityJsonIconReference(input.baseDir);
	if (!reference) return undefined;
	const revision = Math.trunc(statSync(input.filePath).mtimeMs).toString(36);
	const resolver =
		input.assetUrlResolver ?? ((absolutePath: string) => createLocalPresentationAssetUrl(absolutePath, revision));
	return resolvePresentationImageReference(input.baseDir, reference, resolver, true);
}
