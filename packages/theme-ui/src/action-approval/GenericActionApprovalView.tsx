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

export interface GenericActionApprovalField {
	readonly label: string;
	readonly value: string;
}

export interface GenericActionApprovalViewLabels {
	readonly rejecting: string;
	readonly responding: string;
	readonly showTechnicalDetails: string;
	readonly hideTechnicalDetails: string;
	readonly impactTitle: string;
	readonly impactDescription: string;
}

export interface GenericActionApprovalViewProps {
	readonly confirmLabel: string;
	readonly countdown: string;
	readonly error: string | null;
	readonly fields: readonly GenericActionApprovalField[];
	readonly inputJson: string;
	readonly labels: GenericActionApprovalViewLabels;
	readonly onApprove: () => void;
	readonly onReject: () => void;
	readonly permissionLabel: string;
	readonly responding: boolean;
	readonly summary: string;
	readonly title: string;
}

export function GenericActionApprovalView({
	confirmLabel,
	countdown,
	error,
	fields,
	inputJson,
	labels,
	onApprove,
	onReject,
	permissionLabel,
	responding,
	summary,
	title,
}: GenericActionApprovalViewProps): JSX.Element {
	const [showTechnical, setShowTechnical] = useState(false);

	return (
		<Dialog open>
			<DialogContent
				className="max-h-[90vh] overflow-visible sm:max-w-[520px]"
				showCloseButton={false}
				onInteractOutside={(event) => event.preventDefault()}
			>
				<ThemeSurface slot="root.genericActionApproval.panel" />
				<div className="relative z-10 grid min-h-0 gap-4">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{summary}</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 space-y-3 overflow-y-auto">
						{fields.length > 0 ? (
							<div className="rounded-lg border border-border/50 bg-background/50 px-3">
								{fields.map((field, index) => (
									<div key={`${field.label}-${index}`}>
										{index > 0 && <div className="h-px bg-border/40" />}
										<div className="flex items-start justify-between gap-4 py-1.5">
											<span className="shrink-0 text-[11px] text-muted-foreground">
												{field.label}
											</span>
											<span className="min-w-0 break-words text-right text-[11px] font-medium text-foreground">
												{field.value}
											</span>
										</div>
									</div>
								))}
							</div>
						) : null}

						<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
							<div className="text-[11px] font-semibold text-foreground">{labels.impactTitle}</div>
							<p className="mt-1 text-[11px] leading-5 text-muted-foreground">
								{labels.impactDescription}
							</p>
						</div>

						<div>
							<button
								type="button"
								className="text-[11px] font-medium text-primary hover:underline"
								onClick={() => setShowTechnical((value) => !value)}
							>
								{showTechnical ? labels.hideTechnicalDetails : labels.showTechnicalDetails}
							</button>
							{showTechnical && (
								<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/50 p-3 font-mono text-[10px] leading-4 text-foreground">
									{inputJson}
								</pre>
							)}
						</div>

						<div className="text-[11px] text-muted-foreground">{permissionLabel}</div>
						{error && <div className="text-[11px] text-destructive">{error}</div>}
					</div>
					<DialogFooter>
						<Button variant="outline" size="sm" disabled={responding} onClick={onReject}>
							{labels.rejecting}（{countdown}）
						</Button>
						<Button size="sm" disabled={responding} onClick={onApprove}>
							{responding ? labels.responding : confirmLabel}
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}
