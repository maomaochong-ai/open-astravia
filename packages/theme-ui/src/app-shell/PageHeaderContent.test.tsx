import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PageHeaderModel } from "@astravia-org/theme-sdk/app-shell";
import { PageHeaderContent } from "./PageHeaderContent";

function createModel(overrides: Partial<PageHeaderModel> = {}): PageHeaderModel {
	return {
		leftSlot: null,
		path: "/",
		rightSlot: null,
		sidebarTriggerTitle: "Expand sidebar",
		title: "Astravia",
		titleBadge: null,
		titleHidden: false,
		triggerVisible: false,
		...overrides,
	};
}

const actions = { onExpandSidebar: () => {}, onOverlayClose: () => {}, onOverlayOpen: () => {} };

describe("PageHeaderContent", () => {
	it("renders the utility slot before page actions and window chrome", () => {
		const markup = renderToStaticMarkup(
			<PageHeaderContent
				actions={actions}
				model={createModel({
					rightSlot: <span data-testid="page-action" />,
					utilitySlot: <span data-testid="utility-action" />,
				})}
				narrow={false}
				windowControls={<span data-testid="window-controls" />}
			/>,
		);

		const utilityIndex = markup.indexOf("utility-action");
		const pageActionIndex = markup.indexOf("page-action");
		const windowControlsIndex = markup.indexOf("window-controls");

		expect(utilityIndex).toBeGreaterThan(-1);
		expect(utilityIndex).toBeLessThan(pageActionIndex);
		expect(pageActionIndex).toBeLessThan(windowControlsIndex);
	});
	// 页面动作用户能看到的只有一份；同一插槽渲染两次在顶栏就是一排重复图标。
	it("renders the page action slot exactly once", () => {
		const markup = renderToStaticMarkup(
			<PageHeaderContent actions={actions} model={createModel({ rightSlot: <span data-testid="page-action" /> })} narrow={false} />,
		);

		expect(markup.match(/data-testid="page-action"/g) ?? []).toHaveLength(1);
	});

	it("keeps page actions working when no utility slot is registered", () => {
		const markup = renderToStaticMarkup(
			<PageHeaderContent actions={actions} model={createModel({ rightSlot: <span data-testid="page-action" /> })} narrow={false} />,
		);

		expect(markup).toContain("page-action");
	});

	it("侧边栏触发器可见且给了 leftActions 时，两者合成同一个按钮组", () => {
		const markup = renderToStaticMarkup(
			<PageHeaderContent
				actions={actions}
				model={createModel({
					triggerVisible: true,
					leftActions: <button type="button" aria-label="新会话" />,
				})}
				narrow={false}
			/>,
		);

		// 一个组、两个按钮：触发器与新会话并进同一颗胶囊。
		expect(markup).toContain('data-slot="button-group"');
		expect(markup).toContain('aria-label="Expand sidebar"');
		expect(markup).toContain('aria-label="新会话"');
		// 组内分隔线由 ButtonGroupItem 的 before 伪元素提供，不再插独立分隔元素。
		expect(markup).not.toContain('role="separator"');
	});

	it("没有 leftActions 时触发器仍是独立按钮（行为不变）", () => {
		const markup = renderToStaticMarkup(
			<PageHeaderContent actions={actions} model={createModel({ triggerVisible: true })} narrow={false} />,
		);

		expect(markup).toContain('aria-label="Expand sidebar"');
		expect(markup).not.toContain('data-slot="button-group"');
	});
});
