// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "messageList.compactionBoundary") return "上下文已压缩";
			if (key === "messageList.compactionCard.compacting") return "正在压缩…";
			if (key === "messageList.compactionCard.tokens")
				return `已压缩 ${String(values?.tokens ?? "")} tokens`;
			return key;
		},
	}),
}));

// jotai 原子默认值：isCompacting=false / liveSummary=null（未压缩态）
const { CompactionCard } = await import("./CompactionCard.js");

/**
 * 压缩消息卡的回归测试。
 *
 * 背景：压缩此前渲染为一条静态细线（CompactionBoundary），摘要藏在会话文档里
 * 用户不可见。CompactionCard 升级为可折叠卡：折叠态账目行、展开态摘要全文、
 * 压缩进行中展示 live 流式文本。旧会话数据（无 summary）回落旧细线形态。
 */

afterEach(() => {
	cleanup();
});

describe("CompactionCard", () => {
	it("无 summary 的旧数据：回落静态边界（兼容路径）", () => {
		const { container } = render(<CompactionCard />);
		// 旧边界是细线容器（无按钮、无卡片框）
		expect(container.querySelector("button")).toBeNull();
	});

	it("有 summary：折叠态显示账目行（tokensBefore），摘要默认隐藏", () => {
		render(<CompactionCard summary="已完成配置层迁移" tokensBefore={142300} />);
		expect(screen.getByRole("button", { name: /已压缩 142,300 tokens/ })).toBeTruthy();
		expect(screen.queryByText("已完成配置层迁移")).toBeNull();
	});

	it("点击展开渲染摘要 Markdown；再次点击收起", async () => {
		const user = userEvent.setup();
		render(<CompactionCard summary="已完成配置层迁移" tokensBefore={1000} />);
		await user.click(screen.getByRole("button"));
		expect(screen.getByText("已完成配置层迁移")).toBeTruthy();
		await user.click(screen.getByRole("button"));
		expect(screen.queryByText("已完成配置层迁移")).toBeNull();
	});

	it("无 tokensBefore 但有 summary：标题用通用文案，仍可展开", async () => {
		const user = userEvent.setup();
		render(<CompactionCard summary="摘要正文" />);
		expect(screen.getByRole("button", { name: /上下文已压缩/ })).toBeTruthy();
		await user.click(screen.getByRole("button"));
		expect(screen.getByText("摘要正文")).toBeTruthy();
	});
});
