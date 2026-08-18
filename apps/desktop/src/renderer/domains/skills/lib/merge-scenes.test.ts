import type { InstalledSkill, SkillInfo } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import { describe, expect, it } from "vitest";
import { mergeScenes } from "./merge-scenes";

function customEntry(overrides: Partial<Extract<InstalledSkill, { source: "custom" }>> = {}): InstalledSkill {
	return {
		name: "custom-scene",
		version: "0.5.5",
		installedAt: "2026-08-13T00:00:00.000Z",
		source: "custom",
		enabled: true,
		type: "scene",
		description: "",
		...overrides,
	};
}

function listedScene(overrides: Partial<SkillInfo> = {}): SkillInfo {
	return {
		name: "metrics-review",
		description: "核对指标数据与佐证材料",
		source: "scene",
		type: "scene",
		...overrides,
	};
}

function marketScene(overrides: Partial<MarketAbility> = {}): MarketAbility {
	return {
		slug: "doc-scene",
		type: "scene",
		name: "文档场景",
		description: "市场描述",
		license: "MIT",
		version: "1.0.0",
		author: "vetta",
		icon: "",
		category: "文档处理",
		tags: [],
		sha256: "",
		download_count: 3,
		config: {},
		detail: {},
		updated_at: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

describe("mergeScenes", () => {
	it("列出直接放进 scene 目录但尚未登记清单的本地场景", () => {
		const merged = mergeScenes([], {}, [listedScene()]);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			name: "metrics-review",
			description: "核对指标数据与佐证材料",
			installed: true,
			enabled: true,
			isReadonly: true,
			source: "scene",
		});
	});

	it("本地扫描结果不会与同名清单场景重复", () => {
		const merged = mergeScenes(
			[],
			{
				"metrics-review": customEntry({ name: "metrics-review", description: "清单描述" }),
			},
			[
				listedScene({
					description: "磁盘描述",
				}),
			],
		);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			name: "metrics-review",
			description: "清单描述",
			isCustom: true,
		});
		expect(merged[0].isReadonly).toBeUndefined();
	});

	it("列出用户自己导入的自定义场景", () => {
		const merged = mergeScenes([], {
			"my-scene": customEntry({ name: "my-scene" }),
		});
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			name: "my-scene",
			type: "scene",
			installed: true,
			enabled: true,
			isCustom: true,
			localVersion: "0.5.5",
		});
	});

	it("自定义 skill 不进场景页", () => {
		const merged = mergeScenes([], {
			"some-skill": customEntry({ name: "some-skill", type: "skill" }),
		});
		expect(merged).toEqual([]);
	});

	it("被停用的自定义场景仍然列出，只是 enabled 为 false", () => {
		const merged = mergeScenes([], {
			"paused-scene": customEntry({ name: "paused-scene", enabled: false }),
		});
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ installed: true, enabled: false, isCustom: true });
	});

	it("市场行优先，本地同名条目不重复建卡", () => {
		const merged = mergeScenes([marketScene()], {
			"doc-scene": customEntry({ name: "doc-scene", description: "本地描述" }),
		});
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			name: "doc-scene",
			description: "市场描述",
			version: "1.0.0",
		});
	});
});
