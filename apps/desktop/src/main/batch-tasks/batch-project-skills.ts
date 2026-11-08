import type { BatchSkillRef } from "./batch-task-storage.js";

/** 一个项目最多挂 8 个技能：再多就不再是「组合技能」，而是把提示词写成了一团。 */
export const MAX_PROJECT_SKILLS = 8;

function hasText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** 单个技能的运行时校验：IPC 与插件都从边界把数据送进来，结构先过这一关。 */
export function isBatchSkill(value: unknown): value is BatchSkillRef {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	const skill = value as Record<string, unknown>;
	return (
		hasText(skill.name) &&
		(skill.alias === undefined || hasText(skill.alias)) &&
		skill.type === "skill" &&
		Object.keys(skill).every((key) => key === "name" || key === "alias" || key === "type")
	);
}

/**
 * 多技能列表校验：数量、逐项结构、重名（同名技能只能选一次，否则同一段正文会注入两次）。
 */
export function isBatchSkillList(value: unknown): value is BatchSkillRef[] {
	if (!Array.isArray(value) || value.length > MAX_PROJECT_SKILLS) return false;
	if (!value.every(isBatchSkill)) return false;
	const names = value.map((skill: BatchSkillRef) => skill.name.trim());
	return new Set(names).size === names.length;
}

/** 渲染层可能传入前后空格与重复项：写入存储前统一 trim 并保序去重。 */
export function normalizeBatchSkills(skills: readonly BatchSkillRef[]): BatchSkillRef[] {
	const seen = new Set<string>();
	const normalized: BatchSkillRef[] = [];
	for (const skill of skills) {
		const name = skill.name.trim();
		if (seen.has(name)) continue;
		seen.add(name);
		const alias = skill.alias?.trim();
		normalized.push({ name, ...(alias ? { alias } : {}), type: "skill" });
	}
	return normalized;
}

/**
 * 旧调用方（官方插件的 `skill` 字段、未升级的渲染层）只传单个技能：并入 `skills`，
 * 否则这次写入会把技能静默丢成「没挂技能」。两者都没传时返回 `undefined`，交给调用方
 * 区分「没提到」与「清空」。
 */
export function resolveProjectSkills(input: {
	skill?: BatchSkillRef | null;
	skills?: readonly BatchSkillRef[] | null;
}): BatchSkillRef[] | undefined {
	if (input.skills && input.skills.length > 0) return normalizeBatchSkills(input.skills);
	if (input.skill) return normalizeBatchSkills([input.skill]);
	return undefined;
}
