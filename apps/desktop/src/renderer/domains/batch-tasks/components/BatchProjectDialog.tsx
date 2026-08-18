import type { BatchProject } from "@shared/store/atoms";
import { useBatchProjectDialogModel } from "../hooks/useBatchProjectDialogModel";
import { BatchProjectDialogView } from "./BatchProjectDialogView";

interface BatchProjectDialogProps {
	open: boolean;
	project?: BatchProject;
	onClose: () => void;
}

export function BatchProjectDialog({ open, project, onClose }: BatchProjectDialogProps): JSX.Element {
	const model = useBatchProjectDialogModel({ open, project, onClose });
	return <BatchProjectDialogView open={open} model={model} onClose={onClose} />;
}
