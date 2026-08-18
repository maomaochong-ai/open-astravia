import { BatchProjectArtifactFieldView } from "@vetta/theme-ui/batch-tasks";
import { useTranslation } from "react-i18next";
import { compactLines } from "../../utils/batchProjectFormData";

export function BatchProjectArtifactField({
	value,
	onChange,
}: {
	value: string;
	onChange: (patterns: string[]) => void;
}): JSX.Element {
	const { t } = useTranslation("batch-tasks");
	return (
		<BatchProjectArtifactFieldView
			value={value}
			onChange={(next) => onChange(compactLines(next.split(/\r?\n/)))}
			labels={{
				title: t("form.artifact"),
				optional: t("form.optional"),
				placeholder: t("form.artifactPlaceholder"),
				hint: t("form.artifactHint"),
			}}
		/>
	);
}
