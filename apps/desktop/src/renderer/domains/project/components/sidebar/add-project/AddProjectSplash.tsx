import { SplashPanel, SplashStep } from "@astravia-org/theme-ui/overlays";
import { useTranslation } from "react-i18next";
import { AddProjectGitStep } from "./AddProjectGitStep";
import { AddProjectNameStep } from "./AddProjectNameStep";
import { AddProjectRemoteStep } from "./AddProjectRemoteStep";
import { AddProjectRootStep } from "./AddProjectRootStep";
import type { AddProjectMenuItemModel, AddProjectStep } from "./types";

interface AddProjectSplashProps {
	open: boolean;
	step: AddProjectStep;
	items: AddProjectMenuItemModel[];
	onClose: () => void;
	onBack: () => void;
	isProjectNameTaken: (name: string) => boolean;
	onCreateProject: (name: string) => void;
	onCloned: (path: string) => void;
	onRemoteConfirm: (hostId: string, remotePath: string) => void;
}

/**
 * 「添加项目」的全部功能都在这一个 Splash 里完成：入口列表是第一步，
 * 新建、Git 导入、远程主机各自是二级步骤，只换头部与内容，外壳不动。
 * 打开项目、导入项目是原生对话框，没有步骤，点了就关。
 */
export function AddProjectSplash({
	open,
	step,
	items,
	onClose,
	onBack,
	isProjectNameTaken,
	onCreateProject,
	onCloned,
	onRemoteConfirm,
}: AddProjectSplashProps): JSX.Element {
	const { t } = useTranslation("project");
	return (
		<SplashPanel open={open} onClose={onClose} label={t("addProjectSplash.title")} width="520px">
			<SplashStep stepKey={step}>
				{step === "root" && <AddProjectRootStep items={items} onClose={onClose} />}
				{step === "newProject" && (
					<AddProjectNameStep onConfirm={onCreateProject} onBack={onBack} isNameTaken={isProjectNameTaken} />
				)}
				{step === "cloneFromGit" && <AddProjectGitStep onCloned={onCloned} onBack={onBack} />}
				{step === "remoteHost" && <AddProjectRemoteStep onConfirm={onRemoteConfirm} onBack={onBack} />}
			</SplashStep>
		</SplashPanel>
	);
}
