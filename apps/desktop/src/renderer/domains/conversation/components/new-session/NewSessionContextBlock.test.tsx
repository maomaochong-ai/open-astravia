// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RegisteredNewSessionContext } from "@shared/store/plugin-atoms";
import { afterEach, describe, expect, it } from "vitest";
import type { ActiveNewSessionContext } from "./new-session-context-activation";
import { NewSessionContextBlock } from "./NewSessionContextBlock";

function active(contextId: string, label: string): ActiveNewSessionContext {
	return {
		contribution: {
			pluginId: contextId.split(":")[0]!,
			pluginName: "plugin",
			contextId,
			label,
			activateWhen: { agents: ["designer"] },
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

	it("yields the area while the command panel is open", () => {
		const view = render(
			<NewSessionContextBlock contexts={[active("a:one", "一")]} renderContext={renderContext} hidden />,
		);

		expect(view.container.querySelector('[data-new-session-context="true"]')).toBeNull();
	});
});
