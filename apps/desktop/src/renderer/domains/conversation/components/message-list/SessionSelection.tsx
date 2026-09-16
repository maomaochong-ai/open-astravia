import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSelectionContextMenuView } from "@vetta-org/theme-ui/chat";
import { useMessageSelectionContextMenu } from "../../hooks/useMessageSelectionContextMenu";

/** Selection-to-composer is a session capability, not a feed capability. */
export function SessionSelection({ children }: { children: ReactNode }) {
	const menu = useMessageSelectionContextMenu();
	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			ref={menu.containerRef}
			onContextMenuCapture={menu.onContextMenuCapture}
		>
			{children}
			{menu.contextMenu
				? createPortal(<MessageSelectionContextMenuView {...menu.contextMenu} />, document.body)
				: null}
		</div>
	);
}
