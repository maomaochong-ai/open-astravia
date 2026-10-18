// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownHostFixture } from "./markdown-host.fixture";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			key === "messageList.compactionStep.tokensBefore" ? `${values?.tokens} tokens before` : key,
	}),
}));

import { CompactionBlockView } from "./CompactionBlock";

afterEach(cleanup);

describe("CompactionBlockView", () => {
	it("按 Markdown 预览展开压缩摘要，而不是原文墙", () => {
		const { host } = createMarkdownHostFixture();
		render(
			<RendererMarkdownScope
				value={{
					host,
					theme: "light",
					labels: { copy: "Copy", copied: "Copied" },
					getFileIconClass: () => "",
					onOpenFile: () => {},
					onOpenUrl: () => {},
				}}
			>
				<CompactionBlockView
					block={{
						id: "c1",
						type: "compaction",
						status: "success",
						tokensBefore: 120_000,
						summary: "## 已完成的工作\n\n- **登录** 流程收尾\n\n```ts\nconst a = 1;\n```",
					}}
				/>
			</RendererMarkdownScope>,
		);

		// 折叠状态下只显示标题与压缩前用量，摘要正文不占版面。
		expect(screen.queryByText("登录")).toBeNull();
		fireEvent.click(screen.getByRole("button"));

		const heading = screen.getByRole("heading", { name: "已完成的工作" });
		expect(heading.tagName).toBe("H2");
		expect(screen.getByText("登录").tagName).toBe("STRONG");
		expect(screen.getByText("const a = 1;")).toBeTruthy();
		// 原文墙会让 Markdown 标记直接出现在文本里。
		expect(screen.queryByText(/##\s*已完成的工作/)).toBeNull();
	});
});
