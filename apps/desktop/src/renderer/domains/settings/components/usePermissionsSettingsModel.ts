import type { PermissionKind, PermissionStatus, PermissionsSnapshot } from "@preload/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";

export interface PermissionItemModel {
	description: string;
	field: keyof PermissionsSnapshot;
	hideStatus?: boolean;
	icon: string;
	kind: PermissionKind;
	title: string;
}

export interface PermissionsSettingsModel {
	actions: {
		open: (kind: PermissionKind) => Promise<void>;
	};
	error: string | null;
	items: PermissionItemModel[];
	labels: {
		checkInSystemSettings: string;
		goToAuthorize: string;
		sectionSystem: string;
		status: Record<PermissionStatus, string>;
		subtitle: string;
		title: string;
	};
	snapshot: PermissionsSnapshot | null;
}

const ITEM_DEFS = [
	{
		kind: "full-disk-access",
		field: "fullDiskAccess",
		titleKey: "permFullDiskAccess",
		descKey: "permFullDiskAccessDesc",
		icon: "icon-[mdi--harddisk]",
	},
	{
		kind: "accessibility",
		field: "accessibility",
		titleKey: "permAccessibility",
		descKey: "permAccessibilityDesc",
		icon: "icon-[mdi--gesture-tap]",
	},
	{
		kind: "screen-recording",
		field: "screenRecording",
		titleKey: "permScreenRecording",
		descKey: "permScreenRecordingDesc",
		icon: "icon-[mdi--monitor-screenshot]",
	},
	{
		kind: "notifications",
		field: "notifications",
		titleKey: "permNotifications",
		descKey: "permNotificationsDesc",
		icon: "icon-[mdi--bell-outline]",
		hideStatus: true,
	},
] as const satisfies ReadonlyArray<{
	descKey: string;
	field: keyof PermissionsSnapshot;
	hideStatus?: boolean;
	icon: string;
	kind: PermissionKind;
	titleKey: string;
}>;

export function usePermissionsSettingsModel(): PermissionsSettingsModel {
	const { t } = useTranslation("settings");
	const [snapshot, setSnapshot] = useState<PermissionsSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setSnapshot(await window.vetta.permissions.checkAll());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void refresh();
		const handler = () => {
			void refresh();
		};
		window.addEventListener("focus", handler);
		return () => {
			window.removeEventListener("focus", handler);
		};
	}, [refresh]);

	const handleOpen = useCallback(async (kind: PermissionKind) => {
		try {
			await window.vetta.permissions.openPane(kind);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const items = useMemo<PermissionItemModel[]>(
		() =>
			ITEM_DEFS.map((item) => ({
				kind: item.kind,
				field: item.field,
				title: t(item.titleKey),
				description: t(item.descKey),
				icon: item.icon,
				hideStatus: "hideStatus" in item ? item.hideStatus : undefined,
			})),
		[t],
	);

	const labels = useMemo(
		() => ({
			checkInSystemSettings: t("checkInSystemSettings"),
			goToAuthorize: t("goToAuthorize"),
			sectionSystem: t(SETTINGS_SECTION["permissions-system"].titleKey),
			status: {
				granted: t("granted"),
				denied: t("denied"),
				unknown: t("unknown"),
			},
			subtitle: t("permissionsDescription"),
			title: t("permissions"),
		}),
		[t],
	);

	return {
		actions: {
			open: handleOpen,
		},
		error,
		items,
		labels,
		snapshot,
	};
}
