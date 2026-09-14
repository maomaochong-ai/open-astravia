import { useState, type JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface NavigationOpenApprovalField {
	readonly label: string;
	readonly value: string;
}

export interface NavigationOpenApprovalViewLabels {
	readonly confirm: string;
	readonly permission: string;
	readonly reject: string;
	readonly responding: string;
	readonly title: string;
	readonly showTechnicalDetails: string;
	readonly hideTechnicalDetails: string;
}

export interface NavigationOpenApprovalViewProps {
	readonly countdown: string;
	readonly error: string | null;
	readonly fallbackJson: string | null;
	readonly fields: readonly NavigationOpenApprovalField[];
	readonly impactDescription: string;
	readonly impactTitle: string;
	readonly labels: NavigationOpenApprovalViewLabels;
	readonly onApprove: () => void;
	readonly onReject: () => void;
	readonly responding: boolean;
	readonly summary: string;
}

export function NavigationOpenApprovalView({
	countdown,
	error,
	fallbackJson,
	fields,
	impactDescription,
	impactTitle,
	labels,
	onApprove,
	onReject,
	responding,
	summary,
}: NavigationOpenApprovalViewProps): JSX.Element {
	const [showTechnical, setShowTechnical] = useState(false);

	return (
		<Dialog open>
			<DialogContent
				className="max-h-[90vh] overflow-visible sm:max-w-[520px]"
				showCloseButton={false}
				onInteractOutside={(event) => event.preventDefault()}
			>
				<ThemeSurface slot="root.approval.navigationOpen.panel" />
				<div className="relative z-10 grid min-h-0 gap-4">
					<DialogHeader>
						<DialogTitle>{labels.title}</DialogTitle>
						<DialogDescription>{summary}</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 space-y-3 overflow-y-auto">
						{fields.length > 0 && (
							<div className="space-y-1.5">
								{fields.map((field) => (
									<div
										key={field.label}
										className="flex items-center justify-between rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5"
									>
										<span className="text-[11px] text-muted-foreground">{field.label}</span>
										<span className="text-[11px] font-medium text-foreground">{field.value}</span>
									</div>
								))}
							</div>
						)}
						<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
							<div className="text-[11px] font-semibold text-foreground">{impactTitle}</div>
							<p className="mt-1 text-[11px] leading-5 text-muted-foreground">{impactDescription}</p>
						</div>
						{fallbackJson && (
							<div>
								<button
									type="button"
									className="text-[11px] font-medium text-primary hover:underline"
									onClick={() => setShowTechnical((value) => !value)}
								>
									{showTechnical ? labels.hideTechnicalDetails : labels.showTechnicalDetails}
								</button>
								{showTechnical && (
									<pre className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5 font-mono text-[10px] leading-4 text-foreground">
										{fallbackJson}
									</pre>
								)}
							</div>
						)}
						<div className="text-[11px] text-muted-foreground">{labels.permission}</div>
						{error && <div className="text-[11px] text-destructive">{error}</div>}
					</div>
					<DialogFooter>
						<Button variant="outline" size="sm" disabled={responding} onClick={onReject}>
							{labels.reject}（{countdown}）
						</Button>
						<Button size="sm" disabled={responding} onClick={onApprove}>
							{responding ? labels.responding : labels.confirm}
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}
