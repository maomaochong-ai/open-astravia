import { useTranslation } from "react-i18next";
import type { ImLogEvent } from "@preload/api";
import { ImLogDrawerView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";

export function ImLogDrawer({
	logs,
	onClose,
}: {
	logs: ImLogEvent[];
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<ImLogDrawerView
			logs={logs}
			onClose={onClose}
			section={SETTINGS_SECTION["imbridge-logs"]}
			labels={{
				title: t("logTitle"),
				close: t("close"),
				noLogs: t("noLogs"),
			}}
		/>
	);
}
