import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ cloud: true }));
const files = vi.hoisted(() => ({ manifest: "{}" }));

vi.mock("electron", () => ({
	app: { isPackaged: false, getAppPath: () => "/repo/apps/desktop" },
}));

vi.mock("./i18n/index.js", () => ({
	mainT: (key: string) => key,
}));

vi.mock("../shared/feature-flags.js", () => ({
	isCloudBuildEnabled: () => flags.cloud,
}));

vi.mock("node:fs", () => ({
	existsSync: () => true,
	readFileSync: () => files.manifest,
}));

import { readBuiltinSkillsManifest } from "./builtin-skills.js";

const MANIFEST = {
	"create-skill": {
		name: "create-skill",
		version: "1.0.0",
		source: "builtin",
		enabled: true,
		type: "skill",
	},
	"publish-ability": {
		name: "publish-ability",
		version: "2.1.0",
		source: "builtin",
		enabled: true,
		requiresCloud: true,
		type: "skill",
	},
	"vetta-blog": {
		name: "vetta-blog",
		version: "1.0.0",
		source: "builtin",
		enabled: true,
		type: "skill",
	},
};

describe("readBuiltinSkillsManifest", () => {
	beforeEach(() => {
		flags.cloud = true;
		files.manifest = JSON.stringify(MANIFEST);
	});

	it("完全体构建返回全部内置技能", () => {
		expect(Object.keys(readBuiltinSkillsManifest())).toEqual(["create-skill", "publish-ability", "vetta-blog"]);
	});

	it("lite 构建过滤 requiresCloud 技能（publish-ability 等发布类技能不出现）", () => {
		flags.cloud = false;
		expect(Object.keys(readBuiltinSkillsManifest())).toEqual(["create-skill", "vetta-blog"]);
	});
});
