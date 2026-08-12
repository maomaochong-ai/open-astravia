import { createImSendAttachmentToolRegistration } from "@vetta/runtime-tools/coding";
import { describe, expect, it } from "vitest";
import { isToolSideEffect, normalizeToolSideEffect } from "../src/profiles/index.js";
import {
	createCodingAgentToolSideEffectResolver,
	DEFAULT_HEAVY_TOOL_NAMES,
	type ToolSideEffectDeclaration,
} from "../src/tool-policy/tool-side-effect.js";

describe("normalizeToolSideEffect", () => {
	it("accepts the two declared levels case-insensitively", () => {
		expect(normalizeToolSideEffect("light")).toBe("light");
		expect(normalizeToolSideEffect(" Heavy ")).toBe("heavy");
	});

	it("rejects anything else so unknown declarations fall back to the default", () => {
		expect(normalizeToolSideEffect("destructive")).toBeUndefined();
		expect(normalizeToolSideEffect(undefined)).toBeUndefined();
		expect(normalizeToolSideEffect(1)).toBeUndefined();
		expect(normalizeToolSideEffect({ level: "heavy" })).toBeUndefined();
		expect(isToolSideEffect("heavy")).toBe(true);
		expect(isToolSideEffect("HEAVY")).toBe(false);
	});
});

describe("createCodingAgentToolSideEffectResolver", () => {
	it("defaults undeclared tools to light", () => {
		const resolve = createCodingAgentToolSideEffectResolver({ readDeclarations: () => [] });

		expect(resolve("read")).toBe("light");
	});

	it("falls back to the built-in heavy name list when nothing is declared", () => {
		const resolve = createCodingAgentToolSideEffectResolver({ readDeclarations: () => [] });

		for (const name of DEFAULT_HEAVY_TOOL_NAMES) {
			expect(resolve(name)).toBe("heavy");
		}
	});

	it("covers every preset tool that writes the workspace or bills externally", () => {
		const resolve = createCodingAgentToolSideEffectResolver({ readDeclarations: () => [] });

		for (const name of [
			"vetd_create",
			"vetd_install",
			"generate_image",
			"edit_image",
			"render_remotion_video",
			"content_creation_edit",
		]) {
			expect(resolve(name)).toBe("heavy");
		}
	});

	it("keeps tools that own their confirmation, or touch nothing, out of the gate", () => {
		const resolve = createCodingAgentToolSideEffectResolver({ readDeclarations: () => [] });

		// content_creation_run 自带全局确认对话框；再加一层闸就是双重确认。
		expect(resolve("content_creation_run")).toBe("light");
		// 导入落在插件托管存储，不是用户工作区。
		expect(resolve("content_creation_assets")).toBe("light");
		// 只读。
		expect(resolve("content_creation_inspect")).toBe("light");
	});

	it("honors definition-site declarations carried by runtime-tools registrations", () => {
		// im_send_attachment 不在兜底清单里，heavy 判定完全来自注册处的 sideEffect 声明；
		// 组装层把 registry snapshot 的注册对象接进 readDeclarations 后，这条链路必须成立。
		const registration = createImSendAttachmentToolRegistration({
			sender: { sendAttachment: async () => ({}) },
		});
		const resolve = createCodingAgentToolSideEffectResolver({
			readDeclarations: () => [{ name: registration.tool.name, sideEffect: registration.sideEffect }],
		});

		expect(registration.sideEffect).toBe("heavy");
		expect(resolve("im_send_attachment")).toBe("heavy");
	});

	it("lets an explicit declaration win over the fallback list", () => {
		const resolve = createCodingAgentToolSideEffectResolver({
			readDeclarations: () => [{ name: "vetd_create", side_effect: "light" }],
		});

		expect(resolve("vetd_create")).toBe("light");
	});

	it("reads host-side registrations and plugin contributions alike", () => {
		const resolve = createCodingAgentToolSideEffectResolver({
			readDeclarations: () => [
				{ name: "host_tool", sideEffect: "heavy" },
				{ name: "plugin_tool", side_effect: "heavy" },
				{ name: "bogus_tool", side_effect: "very-heavy" },
			],
		});

		expect(resolve("host_tool")).toBe("heavy");
		expect(resolve("plugin_tool")).toBe("heavy");
		expect(resolve("bogus_tool")).toBe("light");
	});

	it("re-reads declarations on every call so plugin changes take effect immediately", () => {
		const declarations: ToolSideEffectDeclaration[] = [];
		const resolve = createCodingAgentToolSideEffectResolver({ readDeclarations: () => declarations });

		expect(resolve("plugin_tool")).toBe("light");
		declarations.push({ name: "plugin_tool", side_effect: "heavy" });
		expect(resolve("plugin_tool")).toBe("heavy");
	});
});
