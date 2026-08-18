import { BatchProjectNotificationFieldView } from "@vetta/theme-ui/batch-tasks";
import { useTranslation } from "react-i18next";

export function BatchProjectNotificationField({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
}): JSX.Element {
	const { t } = useTranslation("batch-tasks");
	return (
		<BatchProjectNotificationFieldView
			checked={checked}
			onChange={onChange}
			labels={{
				title: t("form.notifyTitle"),
				description: t("form.notifyDesc"),
			}}
		/>
	);
}
