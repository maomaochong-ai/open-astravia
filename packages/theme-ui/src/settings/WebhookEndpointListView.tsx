import type { JSX } from "react";
import { Switch } from "@vetta-org/ui";
import { cn } from "@vetta-org/ui";

export interface WebhookEndpointRowView {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly kindDisplayName: string;
	readonly iconClass?: string;
	readonly urlMask: string | null;
	readonly enabled: boolean;
	readonly hasSignSecret: boolean;
}

export interface WebhookEndpointListViewLabels {
	readonly empty: string;
	readonly test: string;
	readonly testing: string;
	readonly edit: string;
	readonly delete: string;
	readonly sign: string;
}

export interface WebhookEndpointListViewProps {
	readonly labels: WebhookEndpointListViewLabels;
	readonly endpoints: readonly WebhookEndpointRowView[];
	readonly narrow: boolean;
	readonly testingId: string | null;
	readonly rowMessages: Readonly<Record<string, { ok: boolean; text: string } | undefined>>;
	readonly onToggle: (id: string, enabled: boolean) => void;
	readonly onTest: (id: string) => void;
	readonly onEdit: (id: string) => void;
	readonly onDelete: (id: string) => void;
}

export function WebhookEndpointListView({
	labels,
	endpoints,
	narrow,
	testingId,
	rowMessages,
	onToggle,
	onTest,
	onEdit,
	onDelete,
}: WebhookEndpointListViewProps): JSX.Element {
	if (endpoints.length === 0) {
		return <div className="px-5 py-10 text-center text-[12px] text-muted-foreground">{labels.empty}</div>;
	}

	return (
		<div className="divide-y divide-border">
			{endpoints.map((endpoint) => {
				const message = rowMessages[endpoint.id];
				const controls = (
					<div className="flex shrink-0 items-center gap-2">
						<Switch
							checked={endpoint.enabled}
							onCheckedChange={(value) => onToggle(endpoint.id, value)}
						/>
						<button
							type="button"
							onClick={() => onTest(endpoint.id)}
							disabled={testingId === endpoint.id}
							className="whitespace-nowrap rounded-md border border-input bg-secondary px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
							title={labels.test}
						>
							{testingId === endpoint.id ? labels.testing : labels.test}
						</button>
						<button
							type="button"
							onClick={() => onEdit(endpoint.id)}
							className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							title={labels.edit}
						>
							<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={() => onDelete(endpoint.id)}
							className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
							title={labels.delete}
						>
							<span className="icon-[mdi--trash-can-outline] h-3.5 w-3.5" />
						</button>
					</div>
				);

				return (
					<div key={endpoint.id} className="flex flex-col gap-2 px-5 py-3">
						<div className="flex items-center gap-3">
							{endpoint.iconClass && <span className={cn(endpoint.iconClass, "h-5 w-5 shrink-0 text-foreground")} />}
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-center gap-2">
									<span className="truncate text-[13px] font-medium text-foreground">{endpoint.name}</span>
									<span className="shrink-0 whitespace-nowrap rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] text-muted-foreground">
										{endpoint.kindDisplayName}
									</span>
									{endpoint.hasSignSecret && (
										<span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
											{labels.sign}
										</span>
									)}
								</div>
								<div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
									{endpoint.urlMask ?? "—"}
								</div>
							</div>
							{!narrow && controls}
						</div>
						{narrow && <div className="flex justify-end">{controls}</div>}
						{message && (
							<div className={cn("pl-8 text-[11px]", message.ok ? "text-muted-foreground" : "text-red-500")}>
								{message.text}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
