// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * radix 的浮层原语在 jsdom 下依赖大量布局 API，仓库既有做法是把 `@vetta/ui` 换成
 * 结构等价的轻量实现（见 content-creation/test/canvas-project-menu.dom.test.tsx），
 * 这里沿用同一策略：菜单树的渲染与回调路由是被测对象，定位行为交给 radix。
 */
vi.mock("@vetta/ui", () => ({
	cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
	DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuTrigger: () => null,
	DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
	DropdownMenuItem: ({ children, onSelect, disabled, ...props }: MockMenuItemProps) => (
		<button type="button" role="menuitem" disabled={disabled} onClick={() => onSelect?.({} as Event)} {...props}>
			{children}
		</button>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
		<button type="button" role="menuitem">
			{children}
		</button>
	),
	DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
}));

const { SessionContextMenuView } = await import("@vetta/theme-ui/project");

interface MockMenuItemProps extends Omit<ComponentProps<"button">, "onSelect"> {
	onSelect?: (event: Event) => void;
}

describe("SessionContextMenuView", () => {
	it("keeps pin and folder actions for read-only sessions while hiding mutations", () => {
		const onTogglePin = vi.fn();
		const onOpenInFolder = vi.fn();
		render(
			<SessionContextMenuView
				canDelete={false}
				canRename={false}
				labels={{ pin: "Pin", rename: "Rename", openInFolder: "Open folder", delete: "Delete" }}
				onClose={vi.fn()}
				onDelete={vi.fn()}
				onOpenInFolder={onOpenInFolder}
				onRename={vi.fn()}
				onTogglePin={onTogglePin}
				x={10}
				y={10}
			/>,
		);

		expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
		fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Open folder" }));
		expect(onTogglePin).toHaveBeenCalledOnce();
		expect(onOpenInFolder).toHaveBeenCalledOnce();
	});

	it("renders mutating actions when the session allows them", () => {
		const onRename = vi.fn();
		const onDelete = vi.fn();
		render(
			<SessionContextMenuView
				canDelete
				canRename
				labels={{ pin: "Pin", rename: "Rename", openInFolder: "Open folder", delete: "Delete" }}
				onClose={vi.fn()}
				onDelete={onDelete}
				onOpenInFolder={vi.fn()}
				onRename={onRename}
				onTogglePin={vi.fn()}
				x={10}
				y={10}
			/>,
		);

		fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		expect(onRename).toHaveBeenCalledOnce();
		expect(onDelete).toHaveBeenCalledOnce();
	});
});
