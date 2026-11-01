// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsPanelEmptyState } from "./ProjectsPanelEmptyState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
	title: "No projects yet",
	description: "Start a chat and it will show up here",
	newConversation: "Start a chat",
};

function mount(ui: React.ReactElement): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => {
		root.render(ui);
	});
	return container;
}

describe("ProjectsPanelEmptyState", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("offers the start-a-chat action and calls back when pressed", () => {
		const onNewConversation = vi.fn();
		const container = mount(
			<ProjectsPanelEmptyState labels={labels} onNewConversation={onNewConversation} />,
		);

		const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
			candidate.textContent?.includes(labels.newConversation),
		);
		expect(button).toBeDefined();

		act(() => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onNewConversation).toHaveBeenCalledTimes(1);
	});

	it("keeps the secondary action slot optional", () => {
		const container = mount(
			<ProjectsPanelEmptyState labels={labels} onNewConversation={() => {}} />,
		);
		expect(container.textContent).toContain(labels.title);
		expect(container.textContent).toContain(labels.description);
		expect(container.querySelectorAll("button")).toHaveLength(1);
	});

	it("renders the injected secondary action", () => {
		const container = mount(
			<ProjectsPanelEmptyState
				labels={labels}
				onNewConversation={() => {}}
				projectAction={<button type="button">Add project</button>}
			/>,
		);
		expect(container.textContent).toContain("Add project");
		expect(container.querySelectorAll("button")).toHaveLength(2);
	});
});
