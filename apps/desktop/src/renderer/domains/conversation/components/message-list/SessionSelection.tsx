import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSelectionContextMenuView } from "@vetta-org/theme-ui/chat";
import { useMessageSelectionContextMenu } from "../../hooks/useMessageSelectionContextMenu";
import { useAnnotations } from "../annotations/AnnotationScope";
import { useTranslation } from "react-i18next";

/** Selection-to-composer is a session capability, not a feed capability. */
export function SessionSelection({ children }: { children: ReactNode }) {
	const menu = useMessageSelectionContextMenu();
	const annotations = useAnnotations();
	const { t } = useTranslation("chat");
	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			ref={menu.containerRef}
			onContextMenuCapture={menu.onContextMenuCapture}
		>
			{children}
			{menu.contextMenu
				? createPortal(
						<MessageSelectionContextMenuView {...menu.contextMenu}>
							{annotations && menu.selection?.entryId ? (
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
									onClick={() => {
										const selected = menu.selection;
										menu.close();
										if (selected?.entryId)
											annotations.ask(selected.entryId, selected.selectedText.slice(0, 20000), selected.origin ?? null);
									}}
								>
									<span aria-hidden="true" className="icon-[solar--chat-round-dots-linear] h-3.5 w-3.5" />
									{t("annotations.ask")}
								</button>
							) : null}
						</MessageSelectionContextMenuView>,
						document.body,
					)
				: null}
		</div>
	);
}
