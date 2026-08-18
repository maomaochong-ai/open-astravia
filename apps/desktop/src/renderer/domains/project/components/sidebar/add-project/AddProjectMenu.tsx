import { NewProjectDialog } from "@shared/components/NewProjectDialog";
import { cn } from "@shared/lib/utils";
import { AddProjectMenuPopover } from "./AddProjectMenuPopover";
import { AddProjectMenuTrigger } from "./AddProjectMenuTrigger";
import { useAddProjectMenuModel } from "./useAddProjectMenuModel";
import type { AddProjectMenuProps } from "./types";

export function AddProjectMenu({ className, variant = "icon" }: AddProjectMenuProps): JSX.Element {
	const model = useAddProjectMenuModel();

	return (
		<>
			<div className={cn("relative", className)} ref={model.menuRef}>
				<AddProjectMenuTrigger
					open={model.open}
					onClick={model.toggleOpen}
					variant={variant}
				/>
				<AddProjectMenuPopover
					items={model.items}
					open={model.open}
					variant={variant}
				/>
			</div>
			{model.showNewProject && (
				<NewProjectDialog
					onConfirm={model.confirmNewProject}
					onCancel={model.closeNewProjectDialog}
				/>
			)}
		</>
	);
}
