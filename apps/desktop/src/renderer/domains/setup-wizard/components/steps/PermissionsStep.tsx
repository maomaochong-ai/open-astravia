import type { PermissionKind, PermissionStatus, PermissionsSnapshot } from "@preload/api";
import { cn } from "@shared/lib/utils";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const SYSTEM_ITEMS = [
	{
		kind: "full-disk-access" as const,
		field: "fullDiskAccess" as const,
		titleKey: "permFullDiskAccess",
		descKey: "permFullDiskAccessDesc",
		icon: "icon-[solar--server-square-linear]",
	},
	{
		kind: "accessibility" as const,
		field: "accessibility" as const,
		titleKey: "permAccessibility",
		descKey: "permAccessibilityDesc",
		icon: "icon-[solar--hand-shake-linear]",
	},
	{
		kind: "screen-recording" as const,
		field: "screenRecording" as const,
		titleKey: "permScreenRecording",
		descKey: "permScreenRecordingDesc",
		icon: "icon-[solar--monitor-camera-linear]",
	},
	{
		kind: "notifications" as const,
		field: "notifications" as const,
		titleKey: "permNotifications",
		descKey: "permNotificationsDesc",
		icon: "icon-[solar--bell-linear]",
		hideStatus: true,
	},
] as const;

function statusClass(status: PermissionStatus | undefined): string {
	if (status === "granted") return "bg-emerald-500/15 text-emerald-400";
	if (status === "denied") return "bg-destructive/15 text-destructive";
	return "bg-muted text-muted-foreground";
}

export function PermissionsStep(): JSX.Element {
	const { t } = useTranslation(["common", "settings"]);
	const [snapshot, setSnapshot] = useState<PermissionsSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setSnapshot(await window.vetta.permissions.checkAll());
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void refresh();
		const onFocus = () => {
			void refresh();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refresh]);

	const openPane = useCallback(async (kind: PermissionKind) => {
		try {
			await window.vetta.permissions.openPane(kind);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const openComputerUse = useCallback(async () => {
		try {
			await window.vetta.appshot.openOnboarding();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const statusLabel = useMemo(
		() =>
			({
				granted: t("settings:granted"),
				denied: t("settings:denied"),
				unknown: t("settings:unknown"),
			}) as const,
		[t],
	);

	return (
		<div className="flex w-full flex-col gap-5">
			<div className="text-center">
				<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-card/40">
					<span className="icon-[solar--shield-check-linear] h-6 w-6 text-primary" />
				</div>
				<h2 className="text-[15px] font-semibold text-foreground">{t("setupWizard.permissions.title")}</h2>
				<p className="mt-1 text-[12px] text-muted-foreground">{t("setupWizard.permissions.subtitle")}</p>
			</div>

			<section className="space-y-2">
				<h3 className="text-[12px] font-medium text-muted-foreground">{t("setupWizard.permissions.systemSection")}</h3>
				<div className="space-y-2">
					{SYSTEM_ITEMS.map((item) => {
						const status = snapshot?.[item.field];
						return (
							<div
								key={item.kind}
								className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/40 px-3.5 py-3"
							>
								<span className={cn(item.icon, "mt-0.5 h-5 w-5 shrink-0 text-muted-foreground")} />
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-[13px] font-medium text-foreground">{t(`settings:${item.titleKey}`)}</span>
										{!("hideStatus" in item && item.hideStatus) && status && (
											<span
												className={cn(
													"rounded-full px-2 py-0.5 text-[10px] font-medium",
													statusClass(status),
												)}
											>
												{statusLabel[status]}
											</span>
										)}
									</div>
									<p className="mt-0.5 text-[11px] text-muted-foreground">{t(`settings:${item.descKey}`)}</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									className="shrink-0"
									onClick={() => void openPane(item.kind)}
								>
									{t("settings:goToAuthorize")}
								</Button>
							</div>
						);
					})}
				</div>
			</section>

			<section className="rounded-xl border border-border/50 bg-card/40 px-3.5 py-3">
				<div className="flex items-start gap-3">
					<span className="icon-[solar--window-frame-linear] mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
					<div className="min-w-0 flex-1">
						<h3 className="text-[13px] font-medium text-foreground">
							{t("setupWizard.permissions.computerUseTitle")}
						</h3>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							{t("setupWizard.permissions.computerUseDesc")}
						</p>
					</div>
					<Button variant="outline" size="sm" className="shrink-0" onClick={() => void openComputerUse()}>
						{t("settings:appshotSetupPermissions")}
					</Button>
				</div>
			</section>

			{error && (
				<p className="flex items-center gap-1.5 text-[12px] text-destructive">
					<span className="icon-[solar--danger-circle-linear] h-3.5 w-3.5" />
					{error}
				</p>
			)}

			<p className="text-center text-[11px] text-muted-foreground/70">{t("setupWizard.permissions.optionalHint")}</p>
		</div>
	);
}
