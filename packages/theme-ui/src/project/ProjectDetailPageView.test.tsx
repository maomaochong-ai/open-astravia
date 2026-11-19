// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDetailPageView, type ProjectDetailPageViewProps } from "./ProjectDetailPageView";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
afterEach(() => {
	if (root) act(() => root.unmount());
	container?.remove();
});

function renderView(overrides: Partial<ProjectDetailPageViewProps> = {}) {
	const handlers = { open: vi.fn(), change: vi.fn(), tab: vi.fn(), start: vi.fn(), save: vi.fn(), openAutomation: vi.fn(), openAll: vi.fn() };
	const labels: ProjectDetailPageViewProps["labels"] = {
		showInFolderTitle: "Folder", showInFolder: "Folder", exportTitle: "Export", export: "Export",
		newSession: "New", closeActivityPanel: "Close", openActivityPanel: "Open", persona: "Persona",
		unsavedChanges: "Unsaved", saved: "Saved", saveFailed: "Failed", save: "Save",
		editorPlaceholder: "Write instructions", agentsMdHint: "Instructions", quickSave: "Quick save", saveShortcut: "Ctrl+S",
		recentSessionsTitle: "Recent sessions", recentSessionsEmpty: "No sessions yet", startFirst: "Start a session",
		running: "1 running session", runningTasks: "1 running automation", automationsTitle: "Automations", automationsViewAll: "View all",
		automationsDisabled: "Paused", automationsNeverRun: "Never run", contextTitle: "Project instructions",
		claudeHint: "Claude instructions",
		previewMode: "Preview", editMode: "Edit",
		emptyFileTitle: "No file yet", emptyFileHint: "Start writing",
		startEditing: "Start writing",
	};
	const props: ProjectDetailPageViewProps = {
		activityOpen: false, activityPanel: null, batchSection: null, activeDocument: "AGENTS.md",
		content: "Project instructions", createdAtLabel: null,
		cwd: "/workspace/project", displayName: "Project", editorFocused: false, exportable: false,
		isDirty: false, labels, loading: false, onContentChange: handlers.change, onEditorBlur: vi.fn(),
		onEditorFocus: vi.fn(), onExport: vi.fn(), onNewSession: handlers.start, onSave: handlers.save,
		onShowInFolder: vi.fn(), onOpenExternal: vi.fn(), onToggleActivity: vi.fn(), onDocumentChange: handlers.tab,
		onOpenRecentSession: handlers.open, onOpenAutomation: handlers.openAutomation, onOpenAllAutomations: handlers.openAll,
		automations: [],
		projectTypeLabel: null, saveStatus: "idle",
		sessionCountLabel: "2 sessions", taskCountLabel: null, textareaRef: { current: null },
		recentSessions: [{ path: "/session/2", label: "Continue project", date: "October 14", running: true }],
		runningSessionCount: 1, runningTaskCount: 0, ...overrides,
	};
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => root.render(<ProjectDetailPageView {...props} />));
	return handlers;
}

describe("Project detail", () => {
	it("opens a recent session and supports preview and edit modes", () => {
		const handlers = renderView();
		const session = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Continue project"));
		act(() => session?.click());
		expect(handlers.open).toHaveBeenCalledWith("/session/2");

		// Default preview mode displays markdown content
		expect(container.textContent).toContain("Project instructions");
		expect(container.querySelector("textarea")).toBeNull();

		// Switch to edit mode
		const editButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
		act(() => editButton?.click());
		const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="AGENTS.md"]');
		expect(editor?.value).toBe("Project instructions");
		expect(container.textContent).toContain("1 running session");
	});

	it("hides the recent sessions block completely when there are no sessions", () => {
		renderView({ recentSessions: [], runningSessionCount: 0 });
		expect(container.querySelector('section[aria-label="Recent sessions"]')).toBeNull();
		expect(container.textContent).not.toContain("Recent sessions");
		expect(container.textContent).not.toContain("Start a session");
	});

	it("switches between recent sessions and automations with tabs", () => {
		const handlers = renderView({
			automations: [
				{ id: "t1", name: "Daily digest", date: "October 14", disabled: false, running: true },
				{ id: "t2", name: "Weekly sweep", date: null, disabled: true, running: false },
			],
			runningTaskCount: 1,
			runningSessionCount: 1,
		});
		const tab = (name: string) => [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLElement;
		// 默认停在会话：看不到自动化行，运行中提示只有会话的
		expect(tab("Recent sessions").getAttribute("aria-selected")).toBe("true");
		expect(container.textContent).toContain("Continue project");
		expect(container.textContent).not.toContain("Daily digest");
		expect(container.textContent).not.toContain("1 running automation");

		act(() => tab("Automations").click());
		const block = container.querySelector('section[aria-label="Automations"]');
		expect(block?.textContent).toContain("1 running automation");
		expect(block?.textContent).toContain("Never run");
		expect(block?.textContent).toContain("Paused");
		expect(block?.textContent).not.toContain("Continue project");
		const row = [...block!.querySelectorAll("button")].find((b) => b.textContent?.includes("Daily digest"));
		act(() => row?.click());
		expect(handlers.openAutomation).toHaveBeenCalledWith("t1");
		const all = [...block!.querySelectorAll("button")].find((b) => b.textContent === "View all");
		act(() => all?.click());
		expect(handlers.openAll).toHaveBeenCalled();
	});

	it("shows only automations without tabs when there are no recent sessions", () => {
		renderView({
			recentSessions: [],
			runningSessionCount: 0,
			automations: [{ id: "t1", name: "Daily digest", date: null, disabled: false, running: false }],
		});
		expect(container.querySelector('[role="tablist"][aria-label="Recent sessions"]')).toBeNull();
		expect(container.textContent).toContain("Daily digest");
		expect(container.querySelector('section[aria-label="Recent sessions"]')).toBeNull();
	});

	it("hides the automations block when the project has none", () => {
		renderView({ automations: [] });
		expect(container.querySelector('section[aria-label="Automations"]')).toBeNull();
	});

	it("edits and saves CLAUDE.md from its tab", () => {
		const handlers = renderView({ activeDocument: "CLAUDE.md", content: "Claude rules", isDirty: true, mode: "edit" });
		const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="CLAUDE.md"]');
		expect(editor?.value).toBe("Claude rules");
		act(() => {
			if (!editor) return;
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, "Updated rules");
			editor.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(handlers.change).toHaveBeenCalledWith("Updated rules");
		const save = container.querySelector<HTMLButtonElement>('button[aria-label="Save"]');
		act(() => save?.click());
		expect(handlers.save).toHaveBeenCalledOnce();
		const agentsTab = container.querySelector<HTMLButtonElement>('[role="tab"][id="project-context-AGENTS.md"]');
		act(() => agentsTab?.click());
		expect(handlers.tab).toHaveBeenCalledWith("AGENTS.md");
	});
});
