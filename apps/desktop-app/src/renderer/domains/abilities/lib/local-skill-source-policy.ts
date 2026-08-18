/** 能力页中不由安装台账管理、只能只读展示的 Skill/Scene 来源。 */
export function isReadonlyLocalSkillSource(source: string): boolean {
	return source.startsWith("agents-") || source === "builtin" || source === "scene";
}
