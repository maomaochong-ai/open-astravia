// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RegisteredNewSessionContext } from "@shared/store/plugin-atoms";
import { afterEach, describe, expect, it } from "vitest";
import type { ActiveNewSessionContext } from "./new-session-context-activation";
import { NewSessionContextBlock } from "./NewSessionContextBlock";

function active(
	contextId: string,
	label: string,
	width: RegisteredNewSessionContext["width"] = "input",
): ActiveNewSessionContext {
	return {
		contribution: {
			pluginId: contextId.split(":")[0]!,
			pluginName: "plugin",
			contextId,
			label,
			activateWhen: { agents: ["designer"] },
			width,
			render: () => null,
			order: 0,
			canReadDraft: false,
		} satisfies RegisteredNewSessionContext,
		strength: "target",
		mentionedSkills: [],
		mentionedMcpServers: [],
	};
}

afterEach(cleanup);

const renderContext = (context: ActiveNewSessionContext) => <div>{`content:${context.contribution.contextId}`}</div>;

describe("NewSessionContextBlock", () => {
	it("renders a single contribution without a tabbar", () => {
		render(<NewSessionContextBlock contexts={[active("a:one", "一")]} renderContext={renderContext} />);

		expect(screen.getByText("content:a:one")).toBeTruthy();
		// 单一来源画一排 tab 是纯粹的噪音。
		expect(screen.queryByRole("tablist")).toBeNull();
	});

	it("shows a tabbar and switches content once two contributions are active", async () => {
		const user = userEvent.setup();
		render(
			<NewSessionContextBlock
				contexts={[active("a:one", "一"), active("b:two", "二")]}
				renderContext={renderContext}
			/>,
		);

		expect(screen.getByText("content:a:one")).toBeTruthy();
		await user.click(screen.getByRole("tab", { name: "二" }));
		expect(screen.getByText("content:b:two")).toBeTruthy();
	});

	it("keeps the user's tab selected when another contribution joins", async () => {
		const user = userEvent.setup();
		const view = render(
			<NewSessionContextBlock
				contexts={[active("a:one", "一"), active("b:two", "二")]}
				renderContext={renderContext}
			/>,
		);
		await user.click(screen.getByRole("tab", { name: "二" }));

		// 边打字边有新插件上屏，不该把用户正在看的那一栏顶掉。
		view.rerender(
			<NewSessionContextBlock
				contexts={[active("a:one", "一"), active("b:two", "二"), active("c:three", "三")]}
				renderContext={renderContext}
			/>,
		);

		expect(screen.getByText("content:b:two")).toBeTruthy();
	});

	it("falls back to the first tab once the selected one stops being active", async () => {
		const user = userEvent.setup();
		const view = render(
			<NewSessionContextBlock
				contexts={[active("a:one", "一"), active("b:two", "二")]}
				renderContext={renderContext}
			/>,
		);
		await user.click(screen.getByRole("tab", { name: "二" }));

		view.rerender(<NewSessionContextBlock contexts={[active("a:one", "一")]} renderContext={renderContext} />);

		expect(screen.getByText("content:a:one")).toBeTruthy();
	});

	it("sizes the area by the selected contribution, not the first one", async () => {
		const user = userEvent.setup();
		const view = render(
			<NewSessionContextBlock
				contexts={[active("a:one", "一", "input"), active("b:two", "二", "wide")]}
				renderContext={renderContext}
			/>,
		);
		const section = () => view.container.querySelector<HTMLElement>('[data-new-session-context="true"]')!;
		const body = () => view.container.querySelector<HTMLElement>('[data-new-session-context-body="true"]')!;
		expect(body().className).toContain("max-w-2xl");

		// 排在后面的 `wide` 贡献被选中时要铺开，不能被第一个的 `input` 宽度压回去。
		await user.click(screen.getByRole("tab", { name: "二" }));
		expect(section().dataset.width).toBe("wide");
		expect(body().className).not.toContain("max-w-2xl");

		await user.click(screen.getByRole("tab", { name: "一" }));
		expect(body().className).toContain("max-w-2xl");
	});

	it("pins the tabbar to the input width while a wide contribution is selected", async () => {
		const user = userEvent.setup();
		render(
			<NewSessionContextBlock
				contexts={[active("a:one", "一", "input"), active("b:two", "二", "wide")]}
				renderContext={renderContext}
			/>,
		);

		// tab 栏是输入框的附属控件：内容铺开时它仍留在输入框左下方，不跟着跑到页面边上。
		await user.click(screen.getByRole("tab", { name: "二" }));
		expect(screen.getByRole("tablist").className).toContain("max-w-2xl");
	});

	it("yields the area while the command panel is open", () => {
		const view = render(
			<NewSessionContextBlock contexts={[active("a:one", "一")]} renderContext={renderContext} hidden />,
		);

		expect(view.container.querySelector('[data-new-session-context="true"]')).toBeNull();
	});
});
