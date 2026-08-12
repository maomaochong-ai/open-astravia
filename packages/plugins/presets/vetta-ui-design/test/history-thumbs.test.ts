import { describe, expect, it } from "vitest";
import { thumbFrameIds } from "../src/history/history-thumbs";

const CANVAS = ["home", "login", "settings", "profile"];

describe("thumbFrameIds", () => {
	it("改了哪几帧就存哪几帧", () => {
		expect(thumbFrameIds(["frames/login.tsx", "frames/home.tsx"], CANVAS)).toEqual(["login", "home"]);
	});

	it("只改共享件时退回画布顺序的前几帧", () => {
		// 共享件改动没有「变更的帧」，却恰恰最需要看图确认。
		expect(thumbFrameIds(["theme.css"], CANVAS)).toEqual(["home", "login", "settings"]);
		expect(thumbFrameIds(["components/NavBar.tsx"], CANVAS)).toEqual(["home", "login", "settings"]);
		expect(thumbFrameIds(["frames/_layout.tsx"], CANVAS)).toEqual(["home", "login", "settings"]);
	});

	it("最多三张", () => {
		const many = ["a", "b", "c", "d", "e"].map((id) => `frames/${id}.tsx`);
		expect(thumbFrameIds(many, CANVAS)).toEqual(["a", "b", "c"]);
	});

	it("同一帧被改多次只算一次", () => {
		expect(thumbFrameIds(["frames/login.tsx", "frames/login.tsx"], CANVAS)).toEqual(["login"]);
	});

	it("画布没开这份设计时，共享件改动就没有图", () => {
		expect(thumbFrameIds(["theme.css"], [])).toEqual([]);
	});

	it("纯文档改动不存图", () => {
		expect(thumbFrameIds(["DESIGN.md"], CANVAS)).toEqual([]);
	});
});
