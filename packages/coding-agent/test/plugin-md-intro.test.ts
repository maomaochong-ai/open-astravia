import { describe, expect, it } from "vitest";
import { stripMdIntroParameter, withMdIntroParameter } from "../src/plugins/runtime/tool-runtime.js";

const schema = {
	type: "object",
	properties: { title: { type: "string" } },
	required: ["title"],
};

describe("md_intro 注入", () => {
	it("给自渲染工具的 schema 追加 md_intro，且不改动插件原对象", () => {
		const injected = withMdIntroParameter(schema) as typeof schema & {
			properties: Record<string, unknown>;
		};
		expect(injected.properties.md_intro).toBeDefined();
		expect(injected.properties.title).toBeDefined();
		expect(injected.required).toEqual(["title"]);
		// md_intro 是可选的：不进 required
		expect(injected.required).not.toContain("md_intro");
		// 插件自己的 schema 对象必须原样不动
		expect("md_intro" in schema.properties).toBe(false);
	});

	it("插件已自行声明 md_intro 时不覆盖", () => {
		const own = { type: "object", properties: { md_intro: { type: "number" } } };
		expect(withMdIntroParameter(own)).toBe(own);
	});

	it("schema 形状不符合预期时原样返回", () => {
		expect(withMdIntroParameter(null)).toBeNull();
		expect(withMdIntroParameter("nope")).toBe("nope");
		const noProps = { type: "object" };
		expect(withMdIntroParameter(noProps)).toBe(noProps);
	});
});

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
