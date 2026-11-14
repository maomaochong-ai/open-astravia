import { Button } from "@astravia-org/ui/button";
import { SplashFooter, SplashInputHeader, SplashNotice } from "@astravia-org/theme-ui/overlays";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "./useEscapeKey";
import { useGitCloneModel } from "./useGitCloneModel";

interface AddProjectGitStepProps {
	onCloned: (path: string) => void;
	onBack: () => void;
}

/** 从 Git 仓库导入：头部是仓库地址输入框，存放目录在下方。 */
export function AddProjectGitStep({ onCloned, onBack }: AddProjectGitStepProps): JSX.Element {
	const { t } = useTranslation("project");
	const model = useGitCloneModel(onCloned);
	// 克隆中 Esc 先停止克隆（停止后留在本步，方便改地址重试），空闲时才返回上一步。
	useEscapeKey(model.cloning ? model.cancel : onBack);

	return (
		<>
			<SplashInputHeader
				icon="icon-[solar--branching-paths-up-linear]"
				label={t("gitCloneDialog.urlLabel")}
				placeholder={t("gitCloneDialog.urlPlaceholder")}
				value={model.url}
				disabled={model.cloning}
				invalid={Boolean(model.error)}
				backLabel={t("addProjectSplash.back")}
				onBack={model.cloning ? undefined : onBack}
				onChange={model.setUrl}
				onSubmit={() => void model.submit()}
			/>
			<div className="flex items-center gap-2 px-4 py-2.5">
				<span className="shrink-0 text-[12px] text-muted-foreground">{t("gitCloneDialog.parentLabel")}</span>
				<span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={model.parentDir}>
					{model.parentDir || "…"}
				</span>
				<Button variant="outline" size="sm" disabled={model.cloning} onClick={() => void model.chooseParentDir()}>
					{t("gitCloneDialog.choose")}
				</Button>
			</div>
			{model.error ? (
				<SplashNotice tone="error">{model.error}</SplashNotice>
			) : (
				<SplashNotice>{t("gitCloneDialog.description")}</SplashNotice>
			)}
			<SplashFooter>
				<span>{model.cloning ? t("gitCloneDialog.cloning") : t("addProjectSplash.hintClone")}</span>
				<span className="ml-auto">
					{model.cloning ? t("addProjectSplash.hintStop") : t("addProjectSplash.hintBack")}
				</span>
				{model.cloning && (
					<Button variant="outline" size="sm" onClick={model.cancel}>
						{t("gitCloneDialog.stop")}
					</Button>
				)}
			</SplashFooter>
		</>
	);
}
