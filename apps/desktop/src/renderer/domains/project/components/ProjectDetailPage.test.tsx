// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectDetailPage } from "./ProjectDetailPage";

const captured = vi.hoisted(() => ({ cwd: undefined as string | undefined }));

vi.mock("../hooks/useProjectDetailPageModel", () => ({
	useProjectDetailPageModel: (cwd?: string) => {
		captured.cwd = cwd;
		return {
			activityOpen: false,
			batchProject: null,
			content: "",
			createdAtLabel: null,
			cwd: cwd ?? "/from-route",
			decodedCwd: cwd ?? "/from-route",
			displayName: "demo",
			editorFocused: false,
			exportable: false,
			isBatch: false,
			isDirty: false,
			labels: {},
			loading: false,
			projectTypeLabel: null,
			saveStatus: "idle",
			sessionCountLabel: "",
			taskCountLabel: null,
			textareaRef: { current: null },
			onContentChange: vi.fn(),
			onEditorBlur: vi.fn(),
			onEditorFocus: vi.fn(),
			onExport: vi.fn(),
			onNewSession: vi.fn(),
			onSave: vi.fn(),
			onShowInFolder: vi.fn(),
			onToggleActivity: vi.fn(),
		};
	},
}));
vi.mock("@vetta-org/theme-ui/project", () => ({
	ProjectDetailPageView: ({ cwd }: { cwd: string }) => <div>{cwd}</div>,
}));
vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({
	CurrentScenarioActivityPanel: () => null,
}));
vi.mock("./BatchQueueStatus", () => ({ BatchQueueStatus: () => null }));
vi.mock("@shared/workspace/active-session-runtime", () => ({
	useActiveSessionRuntimeIds: () => [],
}));
vi.mock("@shared/workspace/activity-workspace", () => ({
	createActivityWorkspace: () => ({}),
}));
vi.mock("motion/react", () => ({
	motion: {
		div: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	},
}));

describe("ProjectDetailPage keep-alive identity", () => {
	it("把保活宿主传入的 cwd 交给页面 model，而不是当前路由", () => {
		const { getByText } = render(<ProjectDetailPage cwd="/tmp/demo" />);
		expect(captured.cwd).toBe("/tmp/demo");
		expect(getByText("/tmp/demo")).toBeTruthy();
	});
});
