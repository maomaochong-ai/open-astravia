import type { FsEntry } from "@shared/store/atoms";
import { ConfirmDeleteDialogView } from "@vetta/theme-ui/file-explorer";
import { useConfirmDeleteDialogModel } from "../hooks/useConfirmDeleteDialogModel";

interface ConfirmDeleteDialogProps {
	entries: readonly FsEntry[];
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDeleteDialog({ entries, onConfirm, onCancel }: ConfirmDeleteDialogProps): JSX.Element {
	const model = useConfirmDeleteDialogModel(entries, onConfirm, onCancel);
	return <ConfirmDeleteDialogView {...model} />;
}
