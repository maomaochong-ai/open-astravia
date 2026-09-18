import { describe, expect, it } from "vitest";
import {
	detailSurfaceForPath,
	MAX_RESIDENT_DETAIL_SURFACES,
	projectDetailShellTitle,
	rememberVisitedDetail,
} from "./detail-surface";

describe("detailSurfaceForPath", () => {
	it("把项目详情、会话查看器和主题页 URL 解析成可保活的 surface", () => {
		expect(detailSurfaceForPath("/project/%2Ftmp%2Fdemo")).toEqual({
			kind: "project",
			key: "project:/tmp/demo",
			cwd: "/tmp/demo",
		});
		expect(detailSurfaceForPath(`/viewer/${encodeURIComponent("/tmp/session.jsonl")}`)).toEqual({
			kind: "viewer",
			key: "viewer:/tmp/session.jsonl",
			path: "/tmp/session.jsonl",
		});
		expect(detailSurfaceForPath("/theme/theme.example/gallery")).toEqual({
			kind: "theme",
			key: "theme:theme.example/gallery",
			themeId: "theme.example",
			pageId: "gallery",
		});
		expect(detailSurfaceForPath("/")).toBeNull();
		expect(detailSurfaceForPath("/settings")).toBeNull();
		expect(detailSurfaceForPath("/project")).toBeNull();
		expect(detailSurfaceForPath("/viewer")).toBeNull();
		expect(detailSurfaceForPath("/theme/theme.example")).toBeNull();
		expect(detailSurfaceForPath("/new-session/%2Ftmp%2Fdemo")).toBeNull();
	});

	it("解码 URL 段，拒绝非法编码", () => {
		expect(detailSurfaceForPath("/theme/a%2Fb/page")).toEqual({
			kind: "theme",
			key: "theme:a/b/page",
			themeId: "a/b",
			pageId: "page",
		});
		expect(detailSurfaceForPath("/project/%E0%A4%A")).toBeNull();
		expect(detailSurfaceForPath("/viewer/%E0%A4%A")).toBeNull();
		expect(detailSurfaceForPath("/theme/%E0%A4%A/gallery")).toBeNull();
	});
});

describe("rememberVisitedDetail", () => {
	it("同一 key 更新到最近，超过上限丢掉最旧的", () => {
		const first = detailSurfaceForPath("/project/%2Ftmp%2Fa");
		const sameProject = detailSurfaceForPath("/project/%2Ftmp%2Fa");
		const second = detailSurfaceForPath(`/viewer/${encodeURIComponent("/tmp/b.jsonl")}`);
		const third = detailSurfaceForPath("/theme/theme.example/gallery");
		if (!first || !sameProject || !second || !third) throw new Error("fixture path");

		const withFirst = rememberVisitedDetail([], first);
		expect(rememberVisitedDetail(withFirst, first)).toBe(withFirst);
		expect(rememberVisitedDetail(withFirst, sameProject)).toBe(withFirst);
		expect(rememberVisitedDetail(withFirst, null)).toBe(withFirst);

		const stacked = rememberVisitedDetail(rememberVisitedDetail(withFirst, second), third);
		expect(stacked.map((item) => item.key)).toEqual(["viewer:/tmp/b.jsonl", "theme:theme.example/gallery"]);
		expect(stacked).toHaveLength(MAX_RESIDENT_DETAIL_SURFACES);

		const bumped = rememberVisitedDetail(stacked, first);
		expect(bumped.map((item) => item.key)).toEqual(["theme:theme.example/gallery", "project:/tmp/a"]);
	});
});

describe("projectDetailShellTitle", () => {
	it("从已解码路径取出目录名，缺省时用回退标题", () => {
		expect(projectDetailShellTitle("/Users/me/open-vetta", "项目详情")).toBe("open-vetta");
		expect(projectDetailShellTitle(undefined, "项目详情")).toBe("项目详情");
	});
});
