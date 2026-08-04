import { describe, expect, test } from "vitest";
import { isImageSkillIcon, isSolarSkillIcon } from "./skill-icon";

describe("isImageSkillIcon", () => {
	test("接受 http(s) 外链与相对路径", () => {
		expect(isImageSkillIcon("https://cdn.example.com/a.png")).toBe(true);
		expect(isImageSkillIcon("http://cdn.example.com/a.png")).toBe(true);
		expect(isImageSkillIcon("/api/v1/files/icon.png")).toBe(true);
		expect(isImageSkillIcon("./skills/create-skill.png")).toBe(true);
		expect(isImageSkillIcon("data:image/png;base64,abc")).toBe(true);
	});

	test("接受开源市场的 vetta-file 本地图标 URL", () => {
		expect(
			isImageSkillIcon(
				"vetta-file://local/C:/Users/x/.vetta/open-marketplaces/src/snapshots/2026.07.1/abilities/skills/demo/icon.svg?v=2026.07.1",
			),
		).toBe(true);
		expect(isImageSkillIcon("vetta-file://local/home/u/.vetta/icon.png")).toBe(true);
	});

	test("拒绝 Solar 预设、空串与未识别值", () => {
		expect(isImageSkillIcon("solar:rocket-2-bold")).toBe(false);
		expect(isImageSkillIcon("")).toBe(false);
		expect(isImageSkillIcon("   ")).toBe(false);
		expect(isImageSkillIcon(null)).toBe(false);
		expect(isImageSkillIcon(undefined)).toBe(false);
		expect(isImageSkillIcon("icon-[solar--star-bold]")).toBe(false);
	});
});

describe("isSolarSkillIcon", () => {
	test("只认 solar: 前缀", () => {
		expect(isSolarSkillIcon("solar:star-bold")).toBe(true);
		expect(isSolarSkillIcon("https://x/a.png")).toBe(false);
		expect(isSolarSkillIcon("")).toBe(false);
	});
});
