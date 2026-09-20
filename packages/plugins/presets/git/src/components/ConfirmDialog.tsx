import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta-org/ui";
import type { ReactNode } from "react";

/**
 * Shared confirmation for git actions that are awkward or impossible to undo
 * (publishing a branch, discarding changes, resetting the index).
 *
 * `data-vetta-plugin-root` is required: the dialog is portalled to the host's
 * document body, outside this plugin's subtree, and without the marker it loses
 * the plugin stylesheet.
 */
export function ConfirmDialog({
	open,
	title,
	description,
	detail,
	confirmLabel,
	destructive = false,
	busy = false,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	description?: string;
	/** Optional extra block under the description, e.g. the affected file list. */
	detail?: ReactNode;
	confirmLabel: string;
	destructive?: boolean;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}): JSX.Element {
	const { t } = useTranslation();
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<DialogContent data-vetta-plugin-root="git" className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description && <DialogDescription>{description}</DialogDescription>}
				</DialogHeader>
				{detail}
				<DialogFooter>
					<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
						{t("confirm.cancel")}
					</Button>
					<Button type="button" variant={destructive ? "destructive" : "default"} size="sm" disabled={busy} onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
