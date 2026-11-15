import type { SkillProvenance } from "@astravia-org/capability-sdk";

interface SkillManifestState {
	enabled?: boolean;
	/** 安装渠道：`market` 从能力市场装的，`custom` 用户自己装的。 */
	source?: string;
}

interface ListedSkillCandidate {
	name: string;
	source: string;
}

/**
 * 市场安装项由清单控制，其余来源未登记时直接列出；一旦存在清单记录，启停状态仍以清单为准。
 */
export function shouldListSkill(skill: ListedSkillCandidate, manifestEntry: SkillManifestState | undefined): boolean {
	if (skill.source === "market") return manifestEntry?.enabled ?? false;
	return !manifestEntry || manifestEntry.enabled !== false;
}

export interface EffectiveSkillOrigin {
	readonly source: string;
	readonly provenance: SkillProvenance;
}

/**
 * 「这个技能是哪来的」——**按谁装的判定，不是按文件落在哪**。
 *
 * 扫描器（skill-loader）只能报告目录类型（几乎总是 `path` / `agents-user`）：它看得见文件，
 * 看不见安装渠道。渠道只存在于清单（`skills-manifest.json`、内置清单）与插件的路径贡献里。
 * 因此优先级是：
 *
 * 1. 落在内置技能目录 → `builtin`；
 * 2. 落在某个插件的 `agent.skillPaths` 下 → `provided/plugin`；
 * 3. 清单登记过 → 用清单的 `source`（`market` / `custom`）；
 * 4. 都没命中 → 用扫描器给的类型。
 *
 * 第 3 条曾经缺失：市场装的技能被算成 `path`，于是在添加面板里全归进「我的」，
 * 表现为「分类识别不全」。provenance 也必须一起覆盖——面板按 `provenance.scope` 分组，
 * 只改 `source` 不改 scope 等于没改。
 */
export function resolveSkillOrigin(input: {
	readonly builtin: boolean;
	readonly pluginId?: string;
	readonly manifestEntry: SkillManifestState | undefined;
	readonly scannedSource: string;
	readonly scannedProvenance?: SkillProvenance;
}): EffectiveSkillOrigin {
	const { builtin, pluginId, manifestEntry, scannedSource, scannedProvenance } = input;

	if (builtin) {
		return { source: "builtin", provenance: { kind: "builtin", providerId: "astravia" } };
	}
	if (pluginId) {
		return { source: "plugin", provenance: { kind: "provided", providerType: "plugin", providerId: pluginId } };
	}
	if (manifestEntry?.source) {
		return { source: manifestEntry.source, provenance: { kind: "native", scope: manifestEntry.source } };
	}
	return {
		source: scannedSource,
		provenance: scannedProvenance ?? { kind: "native", scope: scannedSource },
	};
}
