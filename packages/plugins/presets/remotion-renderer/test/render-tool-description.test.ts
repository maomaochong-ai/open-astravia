/**
 * render_remotion_video 的反向触发描述（改造方案 1.1）。
 *
 * 这个工具会拉起整条浏览器渲染流水线并往工作区写 out/，而「把工作区里的东西渲染出来」
 * 与「构建/预览一个应用」在措辞上很接近，误调的代价是分钟级的无用渲染。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { registerRenderTool } from "../src/tools/render-tool";

interface Registration {
	name: string;
	description?: string;
}

function renderToolDescription(): string {
	const registered = new Map<string, string>();
	const ctx = {
		agent: {
			registerTool: (registration: Registration) => {
				registered.set(registration.name, registration.description ?? "");
				return { dispose: () => {} };
			},
		},
	} as unknown as PluginContext;
	registerRenderTool(ctx);
	const description = registered.get("render_remotion_video");
	if (description === undefined) throw new Error("render_remotion_video 没有注册");
	return description;
}

describe("render_remotion_video description", () => {
	it("describes when NOT to use it and its only legitimate scenario", () => {
		const description = renderToolDescription();
		expect(description).toMatch(/\bDo NOT use\b/);
		expect(description).toMatch(/\bOnly for\b/);
		// 排除段必须给出替代做法，否则模型只知道不能用它，不知道该走哪条路。
		expect(description).toMatch(/project's own build and preview tooling instead/);
	});
});
