import { describe, expect, it } from "vitest";
import { parseInputSegments } from "./parse";
import { pluginTokenText, segmentsToText } from "./serialize";

/**
 * 插件引用与技能、连接器同构：`@plugin:slug`，能被解析回 plugin 段。
 *
 * 这一层是「插件插进对话框」的地基：编辑器的令牌节点、用户气泡的胶囊、重编辑回填
 * 都走同一条序列化 / 解析，格式不一致就会表现为「气泡里是纯文本」。
 */
describe("plugin token", () => {
	it("序列化成 @plugin:slug", () => {
		expect(pluginTokenText("boardmix-whiteboard")).toBe("@plugin:boardmix-whiteboard");
	});

	it("序列化回文本后能解析成 plugin 段", () => {
		const segments = [
			{ kind: "plugin" as const, name: "boardmix-whiteboard", label: "Boardmix 白板" },
			{ kind: "text" as const, text: "看一下这个白板" },
		];
		const text = segmentsToText(segments);
		expect(text).toContain("@plugin:boardmix-whiteboard");
		const parsed = parseInputSegments(text);
		expect(parsed.segments[0]).toMatchObject({ kind: "plugin", name: "boardmix-whiteboard" });
	});

	it("名字含空白时加引号，仍能解析回来", () => {
		const text = pluginTokenText("my plugin");
		expect(text).toBe('@plugin:"my plugin"');
		expect(parseInputSegments(text).segments[0]).toMatchObject({ kind: "plugin", name: "my plugin" });
	});
});
