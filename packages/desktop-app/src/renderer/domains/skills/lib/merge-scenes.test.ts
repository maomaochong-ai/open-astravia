import type { InstalledSkill } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import { describe, expect, it } from "vitest";
import { mergeScenes } from "./merge-scenes";

function customEntry(overrides: Partial<Extract<InstalledSkill, { source: "custom" }>> = {}): InstalledSkill {
	return {
		version: "0.5.5",
		installedAt: "2026-08-13T00:00:00.000Z",
		source: "custom",
		enabled: true,
		type: "scene",
		...overrides,
	};
}

describe("mergeScenes", () => {
	it("列出用户自己导入的自定义场景", () => {
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
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
		});
		expect(merged[0]).toMatchObject({ installed: true, enabled: false });
	});

	it("市场行优先，本地同名条目不重复建卡", () => {
		const market: MarketAbility[] = [
			{
				type: "scene",
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
			},
		];
		expect(merged).toHaveLength(1);
	});
});
