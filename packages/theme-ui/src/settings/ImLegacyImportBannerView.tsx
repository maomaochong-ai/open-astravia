import type { JSX } from "react";
import { Button } from "@vetta-org/ui";

export interface ImLegacyImportBannerViewProps {
	readonly title: string;
	readonly pathLine: string;
	readonly appIdSuffix?: string | null;
	readonly importing: boolean;
	readonly importDisabled: boolean;
	readonly importLabel: string;
	readonly skipLabel: string;
	readonly onImport: () => void;
	readonly onSkip: () => void;
}

export function ImLegacyImportBannerView({
	title,
	pathLine,
	appIdSuffix,
	importing,
	importDisabled,
	importLabel,
	skipLabel,
	onImport,
	onSkip,
}: ImLegacyImportBannerViewProps): JSX.Element {
	return (
		<div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[12px] text-foreground">
			<div className="mb-2 font-medium">{title}</div>
			<div className="mb-3">
				{pathLine}
				{appIdSuffix ? <span className="ml-2 text-primary">{appIdSuffix}</span> : null}
			</div>
			<div className="flex gap-2">
				<Button variant="primary" size="sm" onClick={onImport} disabled={importDisabled}>
					{importLabel}
				</Button>
				<Button variant="outline" size="sm" onClick={onSkip}>
					{skipLabel}
				</Button>
			</div>
		</div>
	);
}
