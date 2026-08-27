import { describe, expect, it } from "vitest";
import { stripMdIntroParameter } from "../src/plugins/runtime/tool-runtime.js";

describe("md_intro 剥离", () => {
	it("调用插件 handler 前剥掉宿主注入的参数", () => {
		expect(stripMdIntroParameter({ title: "A", md_intro: "说明" })).toEqual({ title: "A" });
	});

	it("没有该参数时返回原对象引用", () => {
		const params = { title: "A" };
		expect(stripMdIntroParameter(params)).toBe(params);
	});

	it("非对象入参原样返回", () => {
		expect(stripMdIntroParameter(null)).toBeNull();
		const list = [1, 2];
		expect(stripMdIntroParameter(list)).toBe(list);
	});
});
