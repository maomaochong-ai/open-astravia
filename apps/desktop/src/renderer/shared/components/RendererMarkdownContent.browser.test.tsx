// @vitest-environment jsdom

import { ActivityPanelContextProvider } from "@domains/activity-panel/registry/context";
import { useBrowserPanelModel } from "@domains/activity-panel/hooks/useBrowserPanelModel";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import {
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	browserUrlByWorkspaceAtom,
} from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererMarkdownContent } from "./RendererMarkdownContent";
import { RendererMarkdownScope } from "./RendererMarkdownScope";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

const cases = [
	createActivityWorkspace("C:/projects/vetta", "C:/projects/vetta"),
	createActivityWorkspace("agent-team:delivery", "C:/projects/vetta"),
	createActivityWorkspace("conversation:no-project", null),
] as const;

describe("Markdown browser links", () => {
	it.each(cases)("opens an HTTP link in activity workspace $id", (workspace) => {
		const store = createStore();
		function MarkdownLink(): JSX.Element {
			const model = useRendererMarkdownModel(workspace.cwd, true, workspace.id);
			return (
				<RendererMarkdownScope value={model}>
					<RendererMarkdownContent
						text="**访问地址**：[http://localhost:3000](http://localhost:3000)"
					/>
				</RendererMarkdownScope>
			);
		}
		function BrowserTarget(): JSX.Element {
			const model = useBrowserPanelModel();
			return <output data-testid="browser-target">{`${model.workspaceId}:${model.hasPage}`}</output>;
		}

		render(
			<Provider store={store}>
				<ActivityPanelContextProvider value={{ workspace, knowledgeHistory: false }}>
					<MarkdownLink />
					<BrowserTarget />
				</ActivityPanelContextProvider>
			</Provider>,
		);

		fireEvent.click(screen.getByRole("link", { name: "http://localhost:3000" }));

		expect(store.get(browserUrlByWorkspaceAtom).get(workspace.id)).toBe("http://localhost:3000");
		expect(store.get(activityPanelTabByProjectAtom).get(workspace.id)).toBe("browser");
		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(screen.getByTestId("browser-target").textContent).toBe(`${workspace.id}:true`);
	});
});
