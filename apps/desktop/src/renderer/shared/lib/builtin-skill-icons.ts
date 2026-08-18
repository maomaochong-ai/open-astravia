/**
 * 随 App 分发的内置 Skill 图标（`packages/skill-presets/*`）。内置 Skill 的清单
 * （skills-manifest.json）不带图标字段，图标随 renderer 静态资源走，约定同内置 MCP：
 * 文件放 `src/renderer/public/skills/`，以 `./skills/<file>` 相对 URL 引用。
 */
const BUILTIN_SKILL_ICON_BASE = "./skills";

/** skill 名（= skill-presets 目录名）→ 图标文件名。未列出的落默认图。 */
const BUILTIN_SKILL_ICON_FILES: Record<string, string> = {
	"create-skill": "create-skill.png",
	"publish-ability": "publish-ability.png",
};

export function builtinSkillIconUrl(skillName: string): string | undefined {
	const file = BUILTIN_SKILL_ICON_FILES[skillName];
	return file ? `${BUILTIN_SKILL_ICON_BASE}/${file}` : undefined;
}
