import { describe, expect, it } from "vitest";
import { findOwningMarketPackageEntry, resolveSkillOrigin, shouldListSkill } from "./skill-list-policy";

describe("shouldListSkill", () => {
	it("本地来源未登记清单时直接列出，已登记则由清单控制启停", () => {
		expect(shouldListSkill({ name: "local", source: "user" }, undefined)).toBe(true);
		expect(shouldListSkill({ name: "review", source: "user" }, { enabled: false })).toBe(false);
	});

	it("未登记的市场安装项继续隐藏", () => {
		expect(shouldListSkill({ name: "market-skill", source: "market" }, undefined)).toBe(false);
	});

	it("清单里停用的条目一律不列出（与来源字符串无关）", () => {
		// 回归：调用方必须把清单里的真实来源传进来。以前传的是扫描器给的目录类型
		// （通常是 `path`），市场安装项的来源判定因此永远不成立。
		expect(shouldListSkill({ name: "xlsx", source: "market" }, { enabled: false })).toBe(false);
		expect(shouldListSkill({ name: "xlsx", source: "path" }, { enabled: false })).toBe(false);
		expect(shouldListSkill({ name: "xlsx", source: "market" }, { enabled: true })).toBe(true);
	});
});

describe("resolveSkillOrigin（来源按「谁装的」判定）", () => {
	it("清单登记为市场安装时，覆盖扫描器的目录类型（source 与 provenance 一起改）", () => {
		const origin = resolveSkillOrigin({
			builtin: false,
			manifestEntry: { enabled: true, source: "market" },
			scannedSource: "path",
			scannedProvenance: { kind: "native", scope: "path" },
		});
		expect(origin.source).toBe("market");
		// 回归：只改 source 不改 provenance，面板按 scope 分组时仍会落进「我的」。
		expect(origin.provenance).toEqual({ kind: "native", scope: "market" });
	});

	it("内置与插件贡献优先于清单", () => {
		expect(
			resolveSkillOrigin({
				builtin: true,
				manifestEntry: { source: "market" },
				scannedSource: "path",
			}),
		).toEqual({ source: "builtin", provenance: { kind: "builtin", providerId: "astravia" } });

		expect(
			resolveSkillOrigin({
				builtin: false,
				pluginId: "feishu",
				manifestEntry: undefined,
				scannedSource: "path",
			}),
		).toEqual({
			source: "plugin",
			provenance: { kind: "provided", providerType: "plugin", providerId: "feishu" },
		});
	});

	it("清单没有 source 时保留扫描结果", () => {
		expect(
			resolveSkillOrigin({
				builtin: false,
				manifestEntry: { enabled: true },
				scannedSource: "agents-user",
			}),
		).toEqual({ source: "agents-user", provenance: { kind: "native", scope: "agents-user" } });
	});
});

describe("findOwningMarketPackageEntry", () => {
	const base = "/home/me/.astravia/skills";
	const manifest = {
		"mattpocock-skills": { enabled: true, source: "market" },
		"my-own-pack": { enabled: true, source: "custom" },
	};

	// 回归：组合包内的成员由扫描器报成 `user` 来源、名字不在清单里。不按包的位置归属，
	// 它们会被当成用户自己的技能（分组跑到「我的」），包停用后也照样能插入。
	it("包内成员（含更深层的 references 目录）归到所属市场包", () => {
		expect(
			findOwningMarketPackageEntry(
				`${base}/mattpocock-skills/references/engineering/code-review/SKILL.md`,
				base,
				manifest,
			),
		).toEqual({ enabled: true, source: "market" });
	});

	it("包自身的 SKILL.md 也归该包", () => {
		expect(findOwningMarketPackageEntry(`${base}/mattpocock-skills/SKILL.md`, base, manifest)).toEqual({
			enabled: true,
			source: "market",
		});
	});

	it("只认市场安装的包：自定义包与包外文件都不归属", () => {
		expect(findOwningMarketPackageEntry(`${base}/my-own-pack/a/SKILL.md`, base, manifest)).toBeUndefined();
		expect(findOwningMarketPackageEntry(`${base}/loose/SKILL.md`, base, manifest)).toBeUndefined();
	});

	it("Windows 路径分隔符也能认出来", () => {
		expect(
			findOwningMarketPackageEntry(
				"C:\\Users\\me\\.astravia\\skills\\mattpocock-skills\\references\\a\\SKILL.md",
				"C:\\Users\\me\\.astravia\\skills",
				manifest,
			),
		).toEqual({ enabled: true, source: "market" });
	});
});
