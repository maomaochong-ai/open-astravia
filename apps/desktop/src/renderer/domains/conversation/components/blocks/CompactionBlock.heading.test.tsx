// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 只翻译小节标题，其余键回落到键名本身（与缺译文时组件的行为一致）。 */
const HEADINGS: Record<string, string> = {
	"messageList.compactionHeading.completed": "已完成",
};

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => HEADINGS[key] ?? key,
	}),
}));

import { CompactionBlockView } from "./CompactionBlock";
import { createMarkdownHostFixture } from "./markdown-host.fixture";

afterEach(cleanup);

const SUMMARY = "## Completed\n\n- 登录流程收尾\n";

function renderBlock(status: "running" | "success") {
	const { host } = createMarkdownHostFixture();
	const { container } = render(
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
			<CompactionBlockView block={{ id: "c1", type: "compaction", status, summary: SUMMARY }} />
		</RendererMarkdownScope>,
	);
	return container;
}

describe("CompactionBlockView 摘要标题", () => {
	// 流式期间与落定后必须给出同样的标题：代价在纯函数里用单次扫描短路挡掉，
	// 不允许把它换成「跑字完再翻译」的视觉跳变。
	it("流式期间同样按当前语言渲染小节标题", () => {
		const container = renderBlock("running");
		const text = container.querySelector("[data-compaction-summary]")?.textContent ?? "";
		// 流式与落定必须结果一致：性能靠纯函数里的单次扫描短路，
		// 不能靠「跑字完再翻译」换来标题跳变。
		expect(text).toContain("已完成");
		expect(text).not.toContain("## Completed");
	}, 60_000);

	it("落定后按当前语言渲染小节标题", () => {
		const container = renderBlock("success");
		// success 默认收起，摘要正文要展开才挂载。
		fireEvent.click(screen.getByRole("button"));
		const text = container.querySelector("[data-compaction-summary]")?.textContent ?? "";
		expect(text).toContain("已完成");
		expect(text).not.toContain("## Completed");
	}, 60_000);
});
