// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionViewerPage } from "./SessionViewerPage";

const captured = vi.hoisted(() => ({
	setHeader: vi.fn(),
	onStartExport: vi.fn(),
	onTogglePanel: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
	...(await importOriginal<typeof import("jotai")>()),
	useSetAtom: () => captured.setHeader,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@vetta/theme-sdk/appearance", () => ({ useThemeSurface: () => undefined }));
vi.mock("@vetta/theme-ui/chat", () => ({ SessionViewerPageView: () => <main /> }));
vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({ ActivityPanel: () => <aside /> }));
vi.mock("../hooks/useSessionViewerPageModel", () => ({
	useSessionViewerPageModel: () => ({
		path: "C:/sessions/example.jsonl",
		error: null,
		messages: [{ id: "message-1" }],
		exporting: false,
		exportTitle: "Example",
		isKnowledge: false,
		isIm: true,
		imCwd: "C:/sessions",
		kbCwd: "",
		panelOpen: false,
		emptyPathLabel: "empty",
		errorPrefix: "error",
		onStartExport: captured.onStartExport,
		onTogglePanel: captured.onTogglePanel,
		onExportFinished: vi.fn(),
	}),
}));
vi.mock("./ChatExportHost", () => ({ ChatExportHost: () => null }));
vi.mock("./MessageList", () => ({ MessageList: () => <section /> }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SessionViewerPage header composition", () => {
	it("mounts viewer actions in the page header and wires their commands", async () => {
		render(<SessionViewerPage />);
		const header = captured.setHeader.mock.calls.find(([value]) => value !== null)?.[0];
		expect(header).toBeTruthy();

		render(header);
		expect(screen.getByText("sessionViewer.badge.liveUpdate")).toBeTruthy();
		await userEvent.click(screen.getByTitle("sessionViewer.exportButton.title"));
		await userEvent.click(screen.getByTitle("sessionViewer.panelToggleButton.titleOpen"));

		expect(captured.onStartExport).toHaveBeenCalledOnce();
		expect(captured.onTogglePanel).toHaveBeenCalledOnce();
	});
});
