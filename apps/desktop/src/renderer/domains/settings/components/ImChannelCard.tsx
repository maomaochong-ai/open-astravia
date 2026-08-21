import { useTranslation } from "react-i18next";
import type { ImTransportStatus } from "@preload/api";
import { ImChannelCardView, type ImChannelCardIcon, type ImStatusBadgeStatus } from "@vetta/theme-ui/settings";

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
	icon,
	configured,
	isActive,
	transportStatus,
	configureLabel,
	onConfigure,
	onActivate,
}: {
	name: string;
	subtitle: string;
	icon: ImChannelCardIcon;
	configured: boolean;
	isActive: boolean;
	transportStatus: ImTransportStatus;
	configureLabel: string;
	onConfigure: () => void;
	onActivate?: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const effectiveStatus: ImTransportStatus = isActive ? transportStatus : "offline";

	return (
		<ImChannelCardView
			name={name}
			subtitle={subtitle}
			icon={icon}
			configured={configured}
			isActive={isActive}
			effectiveStatus={effectiveStatus as ImStatusBadgeStatus}
			onConfigure={onConfigure}
			onActivate={onActivate}
			labels={{
				channelActive: t("channelActive"),
				channelConfigured: t("channelConfigured"),
				channelNotAssociated: t("channelNotAssociated"),
				activateChannelTitle: t("activateChannelTitle"),
				configureLabel,
				statusLabel: t(STATUS_LABEL[effectiveStatus] as "imbStatusOffline"),
			}}
		/>
	);
}
