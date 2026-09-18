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
	pathArg: undefined as string | undefined,
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
	useSessionViewerPageModel: (path?: string) => {
		captured.pathArg = path;
		return {
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
		};
	},
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
	captured.pathArg = undefined;
});

describe("SessionViewerPage header composition", () => {
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

describe("SessionViewerPage keep-alive identity", () => {
	it("把保活宿主传入的 path 交给 viewer model，而不是当前路由", () => {
		const kept = encodeURIComponent("/kept/session.jsonl");
		render(<SessionViewerPage path={kept} />);
		expect(captured.pathArg).toBe(kept);
	});
});
