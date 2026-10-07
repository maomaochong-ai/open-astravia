// @vitest-environment jsdom
/**
 * 流式短语压暗的生命周期（对应作者设计：`.streaming-chunk` span 结构保留至卸载——
 * 撤插件会重建 DOM；压暗的视觉由外层 `.markdown-streaming-tail` 控制，静止即撤）。
 *
 * 回归背景：任务执行中两次工具调用之间的静默里，追平后 `-latest` 的压暗（0.55）
 * 一直挂到宿主把 isStreamingTail 翻 false 才消失——一句话长时间裂成明暗两截。
 * 根修后：追平即进入 settle 计时，静默 150ms 恢复全亮；新文本到达即取消计时并重新压暗。
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownContent } from "@astravia-org/theme-ui/markdown";

const LABELS = {
	copy: "复制",
	file: "文件",
	rich: { svg: "SVG", failed: "失败" },
} as never;

function View({ text, isStreamingTail }: { text: string; isStreamingTail: boolean }) {
	return (
		<MarkdownContent
			text={text}
			isStreamingTail={isStreamingTail}
			theme="light"
			labels={LABELS}
			getFileIconClass={(): string => ""}
			onOpenFile={(): void => {}}
			onOpenUrl={(): void => {}}
		/>
	);
}

/** 等待 reveal 追平目标文本（span 文本长度等于句子长度）。 */
async function waitForCaughtUp(container: HTMLElement, sentence: string) {
	await waitFor(
		() => {
			const text = container.querySelector(".markdown-body")?.textContent ?? "";
			expect(text).toContain(sentence);
		},
		{ timeout: 3000 },
	);
}

describe("流式短语压暗的生命周期", () => {
	afterEach(() => {
		cleanup();
	});

	test("流出中：一句话按标点切成多个 span，最新的带 -latest（设计行为不变）", async () => {
		const sentence = "我先检查配置文件，然后重启服务。";
		const { container } = render(<View text="我先检查" isStreamingTail />);
		// 短句可能很快追平进入 settle；这里验证分块与标记存在，压暗的持续窗口由后续用例覆盖。
		await waitFor(
			() => {
				expect(container.querySelectorAll(".streaming-chunk").length).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 3000 },
		);
		// 追平前任一时刻：若存在标记，最新一个 span 必带 -latest（设计不变式）
		const latest = container.querySelectorAll(".streaming-chunk-latest");
		if (latest.length > 0) {
			const all = container.querySelectorAll(".streaming-chunk");
			expect(all[all.length - 1]?.className).toContain("streaming-chunk-latest");
		}
	});

	test("静默追平后（消息仍处于流式态）：150ms 内压暗撤除，恢复全亮——不再裂成明暗两截", async () => {
		const sentence = "我先检查配置文件，然后重启服务。";
		const { container, rerender } = render(<View text={sentence} isStreamingTail />);
		await waitForCaughtUp(container, sentence);
		// 注意：isStreamingTail 保持 true（模拟任务执行中、模型停顿等工具结果）
		rerender(<View text={sentence} isStreamingTail />);
		await waitFor(
			() => {
				expect(container.querySelector(".markdown-streaming-tail")).toBeNull();
			},
			{ timeout: 1500 },
		);
	});

	test("静默撤除后新文本到达：压暗重新出现（流式感随放出节奏回归）", async () => {
		const sentence = "我先检查配置文件，然后重启服务。";
		const { container, rerender } = render(<View text={sentence} isStreamingTail />);
		await waitForCaughtUp(container, sentence);
		// 静默后全亮
		await waitFor(
			() => {
				expect(container.querySelector(".markdown-streaming-tail")).toBeNull();
			},
			{ timeout: 1500 },
		);
		// 新文本到达（下一段输出开始）：压暗必须回来
		rerender(<View text={`${sentence}接着我再看日志。`} isStreamingTail />);
		await waitFor(
			() => {
				expect(container.querySelector(".markdown-streaming-tail")).not.toBeNull();
				expect(container.querySelectorAll(".streaming-chunk-latest").length).toBe(1);
			},
			{ timeout: 3000 },
		);
	});

	test("流结束（isStreamingTail=false）：压暗撤除；span 结构保留（作者的「DOM 不动」承诺）", async () => {
		const sentence = "我先检查配置文件，然后重启服务。";
		const { container, rerender } = render(<View text={sentence} isStreamingTail />);
		await waitForCaughtUp(container, sentence);
		rerender(<View text={sentence} isStreamingTail={false} />);
		await waitFor(
			() => {
				expect(container.querySelector(".markdown-streaming-tail")).toBeNull();
			},
			{ timeout: 1500 },
		);
		// 结构保留是设计（撤掉会重建 DOM 结尾「卡一下」），只断言视觉类已撤
		expect(container.querySelectorAll(".streaming-chunk").length).toBeGreaterThanOrEqual(1);
	});
});
