// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DefaultChatView } from "./DefaultChatView";

const panelRendered = vi.hoisted(() => vi.fn());

vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({
	ActivityPanel: (props: { workspace: { runtimeIds: readonly string[] }; pluginScenario?: string; enabledBuiltinTabs?: readonly string[] }) => {
		panelRendered();
		return createElement("aside", { "data-testid": "activity-panel" },
			`${props.workspace.runtimeIds.join(",")}:${props.pluginScenario ?? ""}:${props.enabledBuiltinTabs === undefined ? "default" : "selected"}`);
	},
	CurrentScenarioActivityPanel: () => createElement("aside", { "data-testid": "current-activity-panel" }),
}));
vi.mock("@domains/bottom-panel/components/BottomPanelHost", () => ({ BottomPanelHost: () => null }));
vi.mock("../ChatExportHost", () => ({ ChatExportHost: () => null }));

describe("chat activity column", () => {
	it("does not redraw for message changes but updates for runtime and scenario changes", () => {
		panelRendered.mockClear();
		const activity = { pluginScenario: "project" as const };
		const workspace = { id: "conversation:a", cwd: "/work", runtimeIds: ["one"] };
		const { rerender } = render(
			<DefaultChatView messages={[]} workspace={workspace} activity={activity}>
				<div>first message</div>
			</DefaultChatView>,
		);
		expect(panelRendered).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("activity-panel").textContent).toBe("one:project:default");

		rerender(
			<DefaultChatView messages={[]} workspace={{ ...workspace, runtimeIds: ["one"] }} activity={{ ...activity }}>
				<div>next message</div>
			</DefaultChatView>,
		);
		expect(screen.getByText("next message")).toBeTruthy();
		expect(panelRendered).toHaveBeenCalledTimes(1);

		rerender(
			<DefaultChatView messages={[]} workspace={{ ...workspace, runtimeIds: ["two"] }} activity={activity}>
				<div>next message</div>
			</DefaultChatView>,
		);
		expect(screen.getByTestId("activity-panel").textContent).toBe("two:project:default");
		expect(panelRendered).toHaveBeenCalledTimes(2);

		rerender(
			<DefaultChatView messages={[]} workspace={{ ...workspace, runtimeIds: ["two"] }} activity={{ pluginScenario: "automation" }}>
				<div>next message</div>
			</DefaultChatView>,
		);
		expect(screen.getByTestId("activity-panel").textContent).toBe("two:automation:default");
		expect(panelRendered).toHaveBeenCalledTimes(3);

		rerender(
			<DefaultChatView messages={[]} workspace={{ ...workspace, runtimeIds: ["two"] }} activity={{ pluginScenario: "automation", enabledBuiltinTabs: [] }}>
				<div>next message</div>
			</DefaultChatView>,
		);
		expect(screen.getByTestId("activity-panel").textContent).toBe("two:automation:selected");
		expect(panelRendered).toHaveBeenCalledTimes(4);
	});
});
