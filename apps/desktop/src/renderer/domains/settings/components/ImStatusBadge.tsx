import { ImStatusBadgeView, type ImStatusBadgeStatus } from "@vetta/theme-ui/settings";
import type { ImTransportStatus } from "@preload/api";
import { useTranslation } from "react-i18next";

const STATUS_LABEL: Record<ImTransportStatus, string> = {
	offline: "imbStatusOffline",
	connecting: "imbStatusConnecting",
	online: "imbStatusOnline",
	error: "imbStatusError",
	awaiting_bind: "imbStatusAwaitingBind",
};

export function ImStatusBadge({ status }: { status: ImTransportStatus }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<ImStatusBadgeView
			label={t(STATUS_LABEL[status] as "imbStatusOffline")}
			status={status as ImStatusBadgeStatus}
		/>
	);
}
