// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			key === "messageList.compactionStep.tokensBefore" ? `${values?.tokens} tokens before` : key,
	}),
}));

import { createMarkdownHostFixture } from "./markdown-host.fixture";
import { CompactionBlockView } from "./CompactionBlock";

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function makeSummary(sections: number): string {
	const parts: string[] = ["## 已完成的工作\n"];
	for (let i = 0; i < sections; i++) {
		parts.push(
			`### 第 ${i} 段\n\n` +
				`- **登录** 流程收尾，涉及 \`auth/session.ts\` 与 \`auth/token.ts\` 两个文件\n` +
				`- 修复了 \`/api/v1/session\` 在过期后重复刷新的问题\n` +
				`- 补充了 [文档](https://example.com/docs/${i}) 链接\n\n` +
				"```ts\nconst a = 1;\nconst b = a + 1;\n```\n\n" +
				`| 字段 | 说明 |\n| --- | --- |\n| id | 会话标识 ${i} |\n| ttl | 过期时间 |\n\n` +
				`> 备注：第 ${i} 段没有遗留问题。\n\n`,
		);
	}
	return parts.join("");
}

const scope = () => {
	const { host } = createMarkdownHostFixture();
	return (
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
			{null}
		</RendererMarkdownScope>
	);
};

describe("CompactionBlockView markdown 稳定性", () => {
	it("展开一条长摘要不会陷入更新循环", () => {
		const summary = makeSummary(120);
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
					block={{ id: "c1", type: "compaction", status: "success", tokensBefore: 120_000, summary }}
				/>
			</RendererMarkdownScope>,
		);
		fireEvent.click(screen.getByRole("button"));
		expect(screen.getByRole("heading", { name: "已完成的工作" })).toBeTruthy();
	}, 60_000);

	it("running 状态自动展开长摘要不会陷入更新循环", () => {
		const summary = makeSummary(120);
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
				<CompactionBlockView block={{ id: "c2", type: "compaction", status: "running", summary }} />
			</RendererMarkdownScope>,
		);
		expect(screen.getByRole("heading", { name: "已完成的工作" })).toBeTruthy();
	}, 60_000);
	void scope;
});
