import { beforeEach, describe, expect, it } from "vitest";
import { claimCanvasAutoOpen, resetCanvasAutoOpenCache } from "../src/vetd/auto-open";
import { isPureDesignProject, pickDesignPaths } from "../src/vetd/discover";

function ref(relPath: string): { name: string; path: string; relPath: string } {
	const name = relPath.split("/").pop() ?? relPath;
	return { name, path: `/proj/${relPath}`, relPath };
}

describe("isPureDesignProject", () => {
	it("认纯设计目录", () => {
		expect(isPureDesignProject([ref("landing.vetd/design.json"), ref("app.vetd/design.json")])).toBe(true);
	});

	it("放过根目录的说明文件", () => {
		expect(isPureDesignProject([ref("landing.vetd/design.json"), ref("README.md"), ref("AGENTS.md")])).toBe(true);
	});

	it("有代码就不算纯设计项目", () => {
		expect(isPureDesignProject([ref("landing.vetd/design.json"), ref("src/main.ts")])).toBe(false);
	});

	it("嵌套目录里的同名说明文件不豁免", () => {
		expect(isPureDesignProject([ref("landing.vetd/design.json"), ref("docs/readme.md")])).toBe(false);
	});

	it("设计包里的源码不破坏纯设计判定", () => {
		expect(
			isPureDesignProject([
				ref("app.vetd/design.json"),
				ref("app.vetd/theme.css"),
				ref("app.vetd/frames/home.tsx"),
				ref("app.vetd/assets/logo.png"),
			]),
		).toBe(true);
	});

	it("还没迁移的旧格式同样算设计项目", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("landing.vetd.d/frames/home.tsx")])).toBe(true);
	});

	it("没有设计稿就不是设计项目", () => {
		expect(isPureDesignProject([ref("README.md")])).toBe(false);
		expect(isPureDesignProject([])).toBe(false);
	});

	it("设计包里的同名文件不算一份设计", () => {
		expect(isPureDesignProject([ref("landing.vetd/assets/nested.vetd")])).toBe(false);
	});
});

describe("pickDesignPaths", () => {
	it("按 design.json 反推设计包目录并排序", () => {
		expect(
			pickDesignPaths([
				ref("b.vetd/design.json"),
				ref("a.vetd/design.json"),
				ref("a.vetd/frames/home.tsx"),
				ref("x.ts"),
			]).bundles,
		).toEqual(["/proj/a.vetd", "/proj/b.vetd"]);
	});

	it("旧格式文件单独归类，包内部的同名文件不算设计", () => {
		const picked = pickDesignPaths([
			ref("legacy.vetd"),
			ref("legacy.vetd.d/frames/home.tsx"),
			ref("a.vetd/design.json"),
			ref("a.vetd/assets/inner.vetd"),
		]);
		expect(picked.bundles).toEqual(["/proj/a.vetd"]);
		expect(picked.legacyFiles).toEqual(["/proj/legacy.vetd"]);
	});
});

describe("claimCanvasAutoOpen", () => {
	beforeEach(() => {
		resetCanvasAutoOpenCache();
	});

	it("同一会话的连发事件只认领一次", () => {
		expect(claimCanvasAutoOpen("s1")).toBe(true);
		expect(claimCanvasAutoOpen("s1")).toBe(false);
	});

	it("切到别的会话再切回，算一次新的打开", () => {
		expect(claimCanvasAutoOpen("s1")).toBe(true);
		expect(claimCanvasAutoOpen("s2")).toBe(true);
		expect(claimCanvasAutoOpen("s1")).toBe(true);
	});

	it("没有会话 id 时不自动打开", () => {
		expect(claimCanvasAutoOpen(null)).toBe(false);
	});
});
