import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	BottomPanelPillsView,
	BottomPanelTabStripView,
	type BottomPanelTabStatus,
} from "./BottomPanelView";

function tab(status: BottomPanelTabStatus) {
	return { tabId: "terminal-1", label: "终端", status } as const;
}

describe("底部面板状态展示", () => {
	it("tab 条不再根据实例忙闲状态显示圆点", () => {
		const render = (status: BottomPanelTabStatus) =>
			renderToStaticMarkup(
				<BottomPanelTabStripView
					tabs={[tab(status)]}
					activeTabId="terminal-1"
					onSelect={() => {}}
					onClose={() => {}}
					labels={{ tablist: "底部面板", close: "关闭" }}
				/>,
			);

		expect(render("active")).toBe(render("idle"));
		expect(render("active")).not.toContain("data-status");
	});

	it("折叠 pill 不再根据实例忙闲状态显示圆点", () => {
		const render = (status: BottomPanelTabStatus) =>
			renderToStaticMarkup(
				<BottomPanelPillsView
					pills={[tab(status)]}
					onSelect={() => {}}
					labels={{ group: "底部面板" }}
				/>,
			);

		expect(render("active")).toBe(render("idle"));
		expect(render("active")).not.toContain("data-status");
	});
});
