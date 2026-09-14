import type { JSX, ReactNode } from "react";
import { Button } from "@vetta-org/ui";
import type { SettingSectionMeta } from "./SettingChrome";
import { SettingHeading } from "./SettingChrome";

export interface TeamSettingsViewProps {
	readonly tokenPresent: boolean;
	readonly loginRequiredLabel: string;
	readonly description: string;
	readonly section: SettingSectionMeta;
	readonly onJoinOpen: () => void;
	readonly onCreateOpen: () => void;
	readonly body: ReactNode;
	readonly dialogs: ReactNode;
}

export function TeamSettingsView({
	tokenPresent,
	loginRequiredLabel,
	description,
	section,
	onJoinOpen,
	onCreateOpen,
	body,
	dialogs,
}: TeamSettingsViewProps): JSX.Element {
	if (!tokenPresent) {
		return <div className="p-6 text-center text-[13px] text-muted-foreground">{loginRequiredLabel}</div>;
	}

	return (
		<div className="mx-auto w-full max-w-2xl space-y-6 px-8 pb-12">
			<div className="flex items-center justify-between">
				<div>
					<SettingHeading section={section} className="text-[18px] font-bold" />
					<p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" size="sm" onClick={onJoinOpen}>
						<span className="icon-[mdi--account-plus-outline] mr-1.5 h-3.5 w-3.5" />
					</Button>
					<Button size="sm" onClick={onCreateOpen}>
						<span className="icon-[mdi--plus] mr-1.5 h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
			{body}
			{dialogs}
		</div>
	);
}
