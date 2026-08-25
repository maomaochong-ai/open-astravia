import type { PluginAiModel } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useState } from "react";
import { useChessRuntime } from "../runtime-context";

interface ModelPickerProps {
	value: string | null;
	className?: string;
	onChange(modelKey: string | null): void;
}

/** Native select over the user's configured text models; hides itself when the list is unavailable. */
export function ModelPicker(props: ModelPickerProps): JSX.Element | null {
	const { t } = useTranslation();
	const { listModels } = useChessRuntime();
	const [models, setModels] = useState<PluginAiModel[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		void listModels().then((result) => {
			if (!cancelled) setModels(result?.models ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [listModels]);
	if (!models || models.length === 0) return null;
	return (
		<select
			className={[
				"max-w-44 truncate rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)]",
				props.className ?? "",
			].join(" ")}
			value={props.value ?? ""}
			aria-label={t("model.label")}
			onChange={(event) => props.onChange(event.target.value === "" ? null : event.target.value)}
		>
			<option value="">{t("newGame.model.default")}</option>
			{models.map((model) => (
				<option key={model.modelKey} value={model.modelKey}>
					{model.name}
				</option>
			))}
		</select>
	);
}
