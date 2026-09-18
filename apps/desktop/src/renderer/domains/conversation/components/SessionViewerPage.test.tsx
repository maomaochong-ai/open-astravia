// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Jotai from "jotai";
import type * as ThemeChat from "@vetta-org/theme-ui/chat";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionViewerPage } from "./SessionViewerPage";

const captured = vi.hoisted(() => ({
	setHeader: vi.fn(),
	onStartExport: vi.fn(),
	onTogglePanel: vi.fn(),
	feed: vi.fn(),
	navigate: vi.fn(),
	origin: undefined as "subagent" | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => captured.navigate,
	useSearch: () => ({ origin: captured.origin }),
}));

vi.mock("jotai", async (importOriginal) => ({
	...(await importOriginal<typeof Jotai>()),
	useSetAtom: () => captured.setHeader,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@vetta-org/theme-sdk/appearance", () => ({ useThemeSurface: () => undefined }));
vi.mock("@vetta-org/theme-ui/chat", async (importOriginal) => ({
	...(await importOriginal<typeof ThemeChat>()),
	SessionViewerPageView: ({ messageList }: { messageList: ReactNode }) => <main>{messageList}</main>,
}));
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
vi.mock("./MessageList", () => ({
	MessageList: (props: unknown) => {
		captured.feed(props);
		return <section />;
	},
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	captured.origin = undefined;
});

describe("SessionViewerPage header composition", () => {
	it("shows a back action for a subagent transcript", async () => {
		captured.origin = "subagent";
		render(<SessionViewerPage />);
		const header = captured.setHeader.mock.calls.find(([value]) => value !== null)?.[0];
		render(header);
		await userEvent.click(screen.getByText("subagentCard.back"));
		expect(captured.navigate).toHaveBeenCalledWith({ to: "/" });
	});

	it("mounts viewer actions in the page header and wires their commands", async () => {
		render(<SessionViewerPage />);
		expect(captured.feed).toHaveBeenCalledWith(
			expect.objectContaining({
				workspace: expect.objectContaining({ id: "C:/sessions", cwd: "C:/sessions" }),
				sessionId: "C:/sessions/example.jsonl",
				isStreaming: false,
			}),
		);
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
