import type { JSX } from "react";
import { cn } from "@vetta-org/ui";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export type PermissionStatusView = "granted" | "denied" | "unknown";

export interface PermissionItemView {
	readonly description: string;
	readonly hideStatus?: boolean;
	readonly id: string;
	readonly status: PermissionStatusView;
	readonly title: string;
}

export interface PermissionsSettingsViewLabels {
	readonly checkInSystemSettings: string;
	readonly goToAuthorize: string;
	readonly sectionSystem: string;
	readonly status: Record<PermissionStatusView, string>;
	readonly subtitle: string;
	readonly title: string;
}

export interface PermissionsSettingsViewProps {
	readonly error: string | null;
	readonly items: readonly PermissionItemView[];
	readonly labels: PermissionsSettingsViewLabels;
	readonly onOpen: (id: string) => void;
	readonly section: SettingSectionMeta;
}

const STATUS_DOT: Record<PermissionStatusView, string> = {
	granted: "bg-emerald-500",
	denied: "bg-amber-500",
	unknown: "bg-muted-foreground/50",
};

const STATUS_TEXT_CLASS: Record<PermissionStatusView, string> = {
	granted: "text-emerald-500",
	denied: "text-amber-500",
	unknown: "text-muted-foreground",
};

function StatusBadge({
	labels,
	status,
}: {
	labels: PermissionsSettingsViewLabels["status"];
	status: PermissionStatusView;
}): JSX.Element {
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-[12px]", STATUS_TEXT_CLASS[status])}>
			<span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
			{labels[status]}
		</span>
	);
}

export function PermissionsSettingsView({
	error,
	items,
	labels,
	onOpen,
	section,
}: PermissionsSettingsViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<h1 className="mb-1.5 text-[20px] font-bold text-foreground">{labels.title}</h1>
			<p className="mb-6 text-[13px] text-muted-foreground">{labels.subtitle}</p>

			{error && (
				<div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-[12px] text-destructive">
					{error}
				</div>
			)}

			<SettingSection title={labels.sectionSystem} section={section}>
				{items.map((item, idx) => {
					const isGranted = item.status === "granted";
					const buttonLabel =
						item.hideStatus || isGranted ? labels.checkInSystemSettings : labels.goToAuthorize;
					return (
						<SettingRow
							key={item.id}
							title={item.title}
							description={item.description}
							border={idx < items.length - 1}
						>
							<div className="flex items-center gap-3">
								{!item.hideStatus && <StatusBadge status={item.status} labels={labels.status} />}
								<button
									type="button"
									onClick={() => onOpen(item.id)}
									className="flex items-center gap-1.5 rounded-lg border border-input bg-secondary px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
								>
									<span className="icon-[mdi--open-in-new] h-3.5 w-3.5 text-muted-foreground" />
									{buttonLabel}
								</button>
							</div>
						</SettingRow>
					);
				})}
			</SettingSection>
		</div>
	);
}
