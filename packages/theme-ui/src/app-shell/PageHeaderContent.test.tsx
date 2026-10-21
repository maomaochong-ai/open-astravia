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
});
