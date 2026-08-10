import { beforeEach, describe, expect, it } from "vitest";
import { claimCanvasAutoOpen, resetCanvasAutoOpenCache } from "../src/vetd/auto-open";
import { isPureDesignProject, pickVetdFiles } from "../src/vetd/discover";

function ref(relPath: string): { name: string; path: string; relPath: string } {
	const name = relPath.split("/").pop() ?? relPath;
	return { name, path: `/proj/${relPath}`, relPath };
}

describe("isPureDesignProject", () => {
	it("认纯设计目录", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("app.vetd")])).toBe(true);
	});

	it("放过根目录的说明文件", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("README.md"), ref("AGENTS.md")])).toBe(true);
	});

	it("有代码就不算纯设计项目", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("src/main.ts")])).toBe(false);
	});

	it("嵌套目录里的同名说明文件不豁免", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("docs/readme.md")])).toBe(false);
	});

	it("没有设计稿就不是设计项目", () => {
		expect(isPureDesignProject([ref("README.md")])).toBe(false);
		expect(isPureDesignProject([])).toBe(false);
	});

	it("sidecar 里的 .vetd 不算数", () => {
		expect(isPureDesignProject([ref("landing.vetd.d/nested.vetd")])).toBe(false);
	});

	it("sidecar 工作目录里的素材文件不破坏纯设计判定", () => {
		expect(
			isPureDesignProject([
				ref("app.vetd"),
				ref("app.vetd.d/theme.css"),
				ref("app.vetd.d/frames/home.tsx"),
				ref("app.vetd.d/assets/logo.png"),
			]),
		).toBe(true);
	});
});

describe("pickVetdFiles", () => {
	it("只取工作态设计稿并排序", () => {
		expect(pickVetdFiles([ref("b.vetd"), ref("a.vetd"), ref("a.vetd.d/inner.vetd"), ref("x.ts")])).toEqual([
			"/proj/a.vetd",
			"/proj/b.vetd",
		]);
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
