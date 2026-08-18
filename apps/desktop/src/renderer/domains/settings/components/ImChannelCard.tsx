import { useTranslation } from "react-i18next";
import type { ImTransportStatus } from "@preload/api";
import { ImChannelCardView, type ImStatusBadgeStatus } from "@vetta/theme-ui/settings";

const STATUS_LABEL: Record<ImTransportStatus, string> = {
	offline: "imbStatusOffline",
	connecting: "imbStatusConnecting",
	online: "imbStatusOnline",
	error: "imbStatusError",
	awaiting_bind: "imbStatusAwaitingBind",
};

export function ImChannelCard({
	name,
	subtitle,
	iconClass,
	configured,
	isActive,
	transportStatus,
	actionLabel,
	onAction,
	onActivate,
}: {
	name: string;
	subtitle: string;
	iconClass: string;
	configured: boolean;
	isActive: boolean;
	transportStatus: ImTransportStatus;
	actionLabel: string;
	onAction: () => void;
	onActivate?: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const effectiveStatus: ImTransportStatus = isActive ? transportStatus : "offline";

	return (
		<ImChannelCardView
			name={name}
			subtitle={subtitle}
			iconClass={iconClass}
			configured={configured}
			isActive={isActive}
			effectiveStatus={effectiveStatus as ImStatusBadgeStatus}
			actionLabel={actionLabel}
			onAction={onAction}
			onActivate={onActivate}
			labels={{
				channelActive: t("channelActive"),
				channelNotAssociated: t("channelNotAssociated"),
				activateChannel: t("activateChannel"),
				activateChannelTitle: t("activateChannelTitle"),
				statusLabel: t(STATUS_LABEL[effectiveStatus] as "imbStatusOffline"),
			}}
		/>
	);
}
