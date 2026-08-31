// @vitest-environment jsdom
import { SessionContextMenuView } from "@vetta/theme-ui/project";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

		expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Pin" }));
		fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
		expect(onTogglePin).toHaveBeenCalledOnce();
		expect(onOpenInFolder).toHaveBeenCalledOnce();
	});
});
