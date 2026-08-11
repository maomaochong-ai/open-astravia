import type { PluginContext, PluginSystemPromptProviderRegistration } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import {
	CONTENT_ASSETS_TOOL_NAME,
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
} from "../src/plugin/register-tools";
import {
	CONTENT_CREATION_TOOL_NAMES,
	registerContentCreationToolRouter,
	selectContentCreationTools,
} from "../src/plugin/tool-routing";
import { renderContentMethodContext, selectContentMethodIds } from "../src/plugin/method-routing";

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

	it("deterministically loads the video and product method bundle", () => {
		const methods = selectContentMethodIds("使用产品主图制作一条 5 秒高级广告视频");

		expect(methods).toEqual([
			"operate-content-workflow",
			"direct-video-creation",
			"product-video-recipe",
		]);
		const context = renderContentMethodContext(methods);
		expect(context).toContain("# Direct AI video creation");
		expect(context).toContain("# Video prompting");
		expect(context).toContain("## Premium product showcase from a source photo");
		expect(context).toContain("promptPlan");
	});

	it("injects the selected method bundle into the real system-prompt provider", async () => {
		let registration: PluginSystemPromptProviderRegistration | undefined;
		const ctx = {
			agent: {
				registerSystemPromptProvider(value: PluginSystemPromptProviderRegistration) {
					registration = value;
					return { dispose() {} };
				},
			},
		} as unknown as PluginContext;
		registerContentCreationToolRouter(ctx);
		const addBlock = vi.fn();
		const setEnabled = vi.fn();

		await registration?.handler({
			conversation: {
				messageCount: 1,
				messages: [{ role: "user", text: "用产品图片创建广告视频" }],
			},
			runtime: {
				availableToolNames: [...CONTENT_CREATION_TOOL_NAMES],
				activeToolNames: [...CONTENT_CREATION_TOOL_NAMES],
			},
			actions: {
				systemPrompt: { addBlock },
				tools: { setEnabled },
			},
		} as unknown as Parameters<PluginSystemPromptProviderRegistration["handler"]>[0]);

		expect(addBlock).toHaveBeenCalledWith(expect.objectContaining({
			id: "plugin.content-creation.required-methods",
			content: expect.stringContaining("product-video-recipe"),
		}));
		expect(setEnabled).toHaveBeenCalledWith(CONTENT_EDIT_TOOL_NAME, true);
	});

	it("loads both static-image and video methods for first/last-frame control", () => {
		const methods = selectContentMethodIds("生成一个精准对齐首尾帧的连续产品视频");
		const context = renderContentMethodContext(methods);

		expect(methods).toEqual([
			"operate-content-workflow",
			"direct-image-creation",
			"direct-video-creation",
			"product-video-recipe",
		]);
		expect(context).toContain("# Image prompt framework");
		expect(context).toContain("# Continuity and references");
		expect(context).toContain("# Reference roles and timed directing");
		expect(context).toContain("configure_video_shot");
	});
});
