import { SplashFooter, SplashInputHeader, SplashNotice } from "@astravia-org/theme-ui/overlays";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "./useEscapeKey";

interface AddProjectNameStepProps {
	onConfirm: (name: string) => void;
	onBack: () => void;
	/** 已被占用的项目名；命中时在确认那一刻拦下，否则重名会静默复用旧项目。 */
	isNameTaken: (name: string) => boolean;
}

/** 新建项目：头部变成项目名输入框。 */
export function AddProjectNameStep({ onConfirm, onBack, isNameTaken }: AddProjectNameStepProps): JSX.Element {
	const { t } = useTranslation("project");
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	useEscapeKey(onBack);

	const submit = (): void => {
		const trimmed = name.trim();
		if (!trimmed) return setError(t("newProjectDialog.emptyError"));
		if (/[/\\:*?"<>|]/.test(trimmed)) return setError(t("newProjectDialog.invalidError"));
		if (isNameTaken(trimmed)) return setError(t("newProjectDialog.duplicateError"));
		onConfirm(trimmed);
	};

	return (
		<>
			<SplashInputHeader
				icon="icon-[solar--add-folder-linear]"
				label={t("newProjectDialog.title")}
				placeholder={t("newProjectDialog.placeholder")}
				value={name}
				invalid={Boolean(error)}
				backLabel={t("addProjectSplash.back")}
				onBack={onBack}
				onChange={(value) => {
					setName(value);
					setError("");
				}}
				onSubmit={submit}
			/>
			<SplashNotice tone={error ? "error" : "muted"}>{error || t("newProjectDialog.description")}</SplashNotice>
			<SplashFooter>
				<span>{t("addProjectSplash.hintCreate")}</span>
				<span className="ml-auto">{t("addProjectSplash.hintBack")}</span>
			</SplashFooter>
		</>
	);
}
