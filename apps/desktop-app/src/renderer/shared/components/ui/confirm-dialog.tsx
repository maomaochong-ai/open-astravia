import { useThemeComponent } from "@vetta/theme-sdk";
import { createPortal } from "react-dom";
import { useConfirmDialogModel } from "../../hooks/useConfirmDialogModel";
import { ConfirmDialogView } from "./ConfirmDialogView";

export function ConfirmDialog(): JSX.Element | null {
	const model = useConfirmDialogModel();
	const ThemedConfirmDialogView = useThemeComponent("root.confirmDialogView", ConfirmDialogView);
	// Portal to body so z-index competes with Drawer/Dialog (also body-portaled).
	// RootGlobalOverlays mounts under AppFrame (`isolate`), which traps stacking;
	// without a portal, open Drawers (z-50) sit above this dialog even at z-[100].
	return createPortal(<ThemedConfirmDialogView {...model} />, document.body);
}
