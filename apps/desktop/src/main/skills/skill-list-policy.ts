import { join } from "node:path";
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

/**
 * 组合包成员的归属：返回包含该文件的「已安装市场包」的清单条目。
 *
 * 像 Pocock 工程流这种一包多技能的包，安装后包内 `references/<分组>/<技能>/SKILL.md` 会被
 * 扫描器当成独立 Skill。它们自己的名字不在清单里，按名字查会落成「用户目录」来源：分组跑到
 * 「我的」、包被停用后成员仍然可插入。成员只是包的一部分，因此按**文件位置**归到所属包，
 * 来源 / 启停 / 分组全部跟着包走。
 *
 * 只认 `source === "market"` 的包：用户自己搭的多技能目录不属于任何安装渠道。
 */
export function findOwningMarketPackageEntry(
	filePath: string,
	baseDir: string,
	manifest: Record<string, SkillManifestState>,
): SkillManifestState | undefined {
	// 路径分隔符两套都可能出现（扫描结果来自实际文件系统），统一后再比较。
	const normalize = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
	const target = normalize(filePath);
	for (const [name, entry] of Object.entries(manifest)) {
		if (entry.source !== "market") continue;
		if (target.startsWith(`${normalize(join(baseDir, name))}/`)) return entry;
	}
	return undefined;
}
