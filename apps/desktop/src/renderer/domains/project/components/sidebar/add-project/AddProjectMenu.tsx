import { cn } from "@shared/lib/utils";
import { AddProjectMenuTrigger } from "./AddProjectMenuTrigger";
import { AddProjectSplash } from "./AddProjectSplash";
import type { AddProjectMenuProps } from "./types";
import { useAddProjectMenuModel } from "./useAddProjectMenuModel";

export function AddProjectMenu({ className, variant = "icon" }: AddProjectMenuProps): JSX.Element {
	const model = useAddProjectMenuModel();

	return (
		<>
			<div className={cn("relative", className)}>
				<AddProjectMenuTrigger open={model.open} onClick={model.openSplash} variant={variant} />
			</div>
			<AddProjectSplash
				open={model.open}
				step={model.step}
				items={model.items}
				onClose={model.closeSplash}
				onBack={model.backToRoot}
				isProjectNameTaken={model.isProjectNameTaken}
				onCreateProject={model.confirmNewProject}
				onCloned={model.confirmGitClone}
				onRemoteConfirm={model.confirmRemoteProject}
			/>
		</>
	);
}
