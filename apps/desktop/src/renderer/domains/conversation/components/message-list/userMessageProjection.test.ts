import { createConversationUserMessage } from "@shared/conversation";
import { type InputSegment, segmentsToText } from "@shared/lib/input-tokens";
import { describe, expect, it } from "vitest";
import { projectUserMessage } from "./userMessageProjection";

describe("projectUserMessage", () => {
	it("发送后的气泡沿用编辑器结构，不把普通 png 文件重新解析成图片", () => {
		const inputSegments: InputSegment[] = [
			{ kind: "text", text: "检查 " },
			{ kind: "file", path: "C:/workspace/screenshot.png" },
			{ kind: "text", text: "然后调整间距" },
		];
		const projection = projectUserMessage(
			createConversationUserMessage({
				id: "user-file",
				text: segmentsToText(inputSegments),
				inputSegments,
				attachments: [{ kind: "file", path: "C:/workspace/screenshot.png" }],
			}),
		);

		expect(projection.displayText).toBe("检查 @C:/workspace/screenshot.png 然后调整间距");
		expect(projection.inlineTokenAnnotations).toEqual([
			{
				kind: "file",
				path: "C:/workspace/screenshot.png",
				text: "@C:/workspace/screenshot.png",
				start: 3,
				end: 31,
			},
		]);
		expect(projection.imageItems).toEqual([]);
		expect(projection.fileBadges).toEqual([]);
	});

	it("图片、目录、能力、连接器与相邻正文共享同一份精确 UTF-16 区间", () => {
		const inputSegments: InputSegment[] = [
			{ kind: "text", text: "🙂" },
			{ kind: "image", path: "C:/workspace/示例图.png" },
			{ kind: "text", text: "，\n" },
			{ kind: "file", path: "C:/workspace/assets", isDirectory: true },
			{ kind: "skill", name: "review" },
			{ kind: "connector", name: "notion" },
			{ kind: "text", text: " https://example.com" },
		];
		const projection = projectUserMessage(
			createConversationUserMessage({
				id: "user-mixed",
				text: segmentsToText(inputSegments),
				inputSegments,
				attachments: [
					{ kind: "image", path: "C:/workspace/示例图.png" },
					{ kind: "directory", path: "C:/workspace/assets" },
				],
			}),
		);

		expect(projection.inlineTokenAnnotations.map((annotation) => annotation.kind)).toEqual([
			"image",
			"file",
			"skill",
			"connector",
		]);
		for (const annotation of projection.inlineTokenAnnotations) {
			expect(projection.displayText.slice(annotation.start, annotation.end)).toBe(annotation.text);
		}
		expect(projection.inlineTokenAnnotations[0]?.start).toBe(3);
		expect(projection.inlineTokenAnnotations[1]).toMatchObject({ kind: "file", isDirectory: true });
	});

	it("规范历史使用附件合同恢复 png 文件与目录类型", () => {
		const projection = projectUserMessage(
			createConversationUserMessage({
				id: "history",
				text: "@C:/workspace/screenshot.png @C:/workspace/assets",
				attachments: [
					{ kind: "file", path: "C:/workspace/screenshot.png" },
					{ kind: "directory", path: "C:/workspace/assets" },
				],
			}),
		);

		expect(projection.inlineTokenAnnotations).toMatchObject([
			{ kind: "file", path: "C:/workspace/screenshot.png" },
			{ kind: "file", path: "C:/workspace/assets", isDirectory: true },
		]);
		expect(projection.imageItems).toEqual([]);
	});

	it("旧消息与 promptRef 仍能生成结构化展示注解", () => {
		const projection = projectUserMessage(
			createConversationUserMessage({
				id: "legacy",
				text: "检查 @skill:legal @/workspace/spec.md",
				promptRef: { kind: "scene", name: "review" },
			}),
		);

		expect(projection.inlineTokenAnnotations.map((annotation) => annotation.kind)).toEqual([
			"scene",
			"skill",
			"file",
		]);
		expect(projection.displayText).toBe("@scene:review 检查 @skill:legal @/workspace/spec.md");
	});

	it("编辑器明确保存为正文的 token 外形文本不会被重新猜成 token", () => {
		const text = "原样保留 @C:/workspace/screenshot.png";
		const projection = projectUserMessage(
			createConversationUserMessage({
				id: "plain-token-shape",
				text,
				inputSegments: [{ kind: "text", text }],
			}),
		);

		expect(projection.displayText).toBe(text);
		expect(projection.inlineTokenAnnotations).toEqual([]);
	});
});
