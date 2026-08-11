import { describe, expect, it } from "vitest";
import {
	CONTENT_ASSETS_TOOL_NAME,
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
} from "../src/plugin/register-tools";
import { CONTENT_CREATION_TOOL_NAMES, selectContentCreationTools } from "../src/plugin/tool-routing";

describe("content creation tool routing", () => {
	it("keeps read-only diagnosis on the inspect tool", () => {
		expect([...selectContentCreationTools("检查一下为什么视频生成失败")]).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_RUN_TOOL_NAME,
		]);
	});

	it("enables edit for planning without exposing run", () => {
		expect([...selectContentCreationTools("帮我设计一个产品海报工作流")]).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
		]);
	});

	it("enables all domain tools for an end-to-end generation request", () => {
		expect([...selectContentCreationTools("创建工作流并生成最终视频")]).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
			CONTENT_RUN_TOOL_NAME,
		]);
	});

	it("enables local asset discovery for a user-supplied directory", () => {
		expect([...selectContentCreationTools("使用 C:\\Users\\admin\\Desktop\\素材 里的图片创建视频")]).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_ASSETS_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
		]);
	});

	it("limits the router allowlist to this plugin's four domain tools", () => {
		expect(CONTENT_CREATION_TOOL_NAMES).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_ASSETS_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
			CONTENT_RUN_TOOL_NAME,
		]);
	});
});
