// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createContext, type ComponentProps, type ReactNode, useContext, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasProjectMenu } from "../src/canvas/CanvasProjectMenu";
import type { ContentModelDescriptor } from "../src/generation/types";
import { createContentProject } from "../src/project/types";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { count?: number }) =>
			values?.count === undefined ? key : `${key}:${values.count}`,
	}),
}));

interface DropdownState {
	open: boolean;
	setOpen: (open: boolean) => void;
}

const DropdownContext = createContext<DropdownState | null>(null);

vi.mock("@vetta/ui", () => ({
	DropdownMenu: ({ children }: { children: ReactNode }) => {
		const [open, setOpen] = useState(false);
		return <DropdownContext.Provider value={{ open, setOpen }}>{children}</DropdownContext.Provider>;
	},
	DropdownMenuTrigger: ({ children }: { children: ReactNode }) => {
		const dropdown = useContext(DropdownContext);
		return <div onClick={() => dropdown?.setOpen(!dropdown.open)}>{children}</div>;
	},
	DropdownMenuContent: ({ children }: { children: ReactNode }) => {
		const dropdown = useContext(DropdownContext);
		return dropdown?.open ? <div role="menu">{children}</div> : null;
	},
	DropdownMenuItem: ({ children, onSelect, ...props }: MockMenuItemProps) => (
		<button type="button" role="menuitem" onClick={() => onSelect?.({} as Event)} {...props}>
			{children}
		</button>
	),
	DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuSeparator: () => <hr />,
}));

interface MockMenuItemProps extends Omit<ComponentProps<"button">, "onSelect"> {
	onSelect?: (event: Event) => void;
}

describe("CanvasProjectMenu", () => {
	afterEach(cleanup);

	it("opens with project-wide status and routes actions through explicit callbacks", () => {
		const project = createContentProject("C:\\workspaces\\campaign");
		project.workflow.title = "Launch campaign";
		project.graph.nodes = [
			{ id: "image", kind: "image-generator", position: { x: 0, y: 0 }, status: "running", data: {} },
			{ id: "video", kind: "video-generator", position: { x: 400, y: 0 }, status: "failed", data: {} },
		];
		project.assets = [
			{ id: "hero", kind: "image", name: "Hero", mimeType: "image/png", createdAt: project.createdAt },
		];
		project.jobs = [createJob("active", "image", "running"), createJob("failed", "video", "failed")];

		const onFitContent = vi.fn();
		const onFocusNodes = vi.fn();
		const onResetZoom = vi.fn();
		const onOpenSettings = vi.fn();
		render(
			<CanvasProjectMenu
				project={project}
				models={[createModel("image"), createModel("video")]}
				onFitContent={onFitContent}
				onFocusNodes={onFocusNodes}
				onResetZoom={onResetZoom}
				onOpenSettings={onOpenSettings}
			/>,
		);

		expect(screen.queryByRole("menu")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "projectMenu.open" }));

		const menu = screen.getByRole("menu");
		expect(within(menu).getByText("Launch campaign")).toBeTruthy();
		expect(within(menu).getByText("campaign")).toBeTruthy();
		expect(within(menu).getByText("projectMenu.stats.nodes").parentElement?.textContent).toBe(
			"2projectMenu.stats.nodes",
		);
		expect(within(menu).getByText("projectMenu.stats.assets").parentElement?.textContent).toBe(
			"1projectMenu.stats.assets",
		);
		expect(within(menu).getByText("projectMenu.stats.models").parentElement?.textContent).toBe(
			"2projectMenu.stats.models",
		);

		fireEvent.click(within(menu).getByRole("menuitem", { name: "projectMenu.action.fitContent" }));
		expect(onFitContent).toHaveBeenCalledOnce();

		fireEvent.click(within(menu).getByRole("menuitem", { name: "projectMenu.action.activeJobs 1" }));
		expect(onFocusNodes).toHaveBeenLastCalledWith(["image"]);

		fireEvent.click(within(menu).getByRole("menuitem", { name: "projectMenu.action.failedJobs 1" }));
		expect(onFocusNodes).toHaveBeenLastCalledWith(["video"]);

		fireEvent.click(
			within(menu).getByRole("menuitem", {
				name: "projectMenu.action.resetZoom projectMenu.zoom.default",
			}),
		);
		expect(onResetZoom).toHaveBeenCalledOnce();

		fireEvent.click(within(menu).getByRole("menuitem", { name: "projectMenu.action.settings" }));
		expect(onOpenSettings).toHaveBeenCalledOnce();
	});

	it("disables location actions that have no current target", () => {
		const project = createContentProject(null);
		render(
			<CanvasProjectMenu
				project={project}
				models={[]}
				onFitContent={vi.fn()}
				onFocusNodes={vi.fn()}
				onResetZoom={vi.fn()}
				onOpenSettings={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "projectMenu.open" }));
		const menu = screen.getByRole("menu");
		expect(within(menu).getByRole("menuitem", { name: "projectMenu.action.fitContent" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			within(menu).getByRole("menuitem", { name: "projectMenu.action.activeJobs 0" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			within(menu).getByRole("menuitem", { name: "projectMenu.action.failedJobs 0" }).hasAttribute("disabled"),
		).toBe(true);
		expect(within(menu).getByText("workspace.global")).toBeTruthy();
		expect(within(menu).getByText("projectMenu.untitled")).toBeTruthy();
	});
});

function createJob(id: string, nodeId: string, status: "running" | "failed") {
	return {
		id,
		nodeId,
		provider: "provider",
		model: "model",
		status,
		progress: 0,
		createdAt: "2026-08-11T00:00:00.000Z",
		updatedAt: "2026-08-11T00:00:00.000Z",
	};
}

function createModel(modelId: string): ContentModelDescriptor {
	return {
		providerId: "provider",
		modelId,
		displayName: modelId,
		outputKind: modelId === "video" ? "video" : "image",
		modes: [],
		aspectRatios: [],
	};
}
