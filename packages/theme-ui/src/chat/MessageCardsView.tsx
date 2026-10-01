import { useState, type JSX, type ReactNode } from "react";

export interface MessageCardsTabItem {
	readonly id: string;
	readonly title: string;
	readonly icon?: ReactNode;
	readonly pending?: boolean;
	readonly body: ReactNode;
}

export interface MessageCardsViewLabels {
	readonly layoutStacked: string;
	readonly layoutList: string;
}

export interface MessageCardsViewProps {
	readonly cards: readonly MessageCardsTabItem[];
	readonly labels: MessageCardsViewLabels;
	readonly messageId: string;
}

function IconStack({ active }: { active: boolean }): JSX.Element {
	return (
		<svg viewBox="0 0 24 24" fill="none" className={active ? "text-primary" : ""}>
			<rect x="4" y="4" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
			<path d="M7 17.5h10M9 20.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
		</svg>
	);
}

function IconList({ active }: { active: boolean }): JSX.Element {
	return (
		<svg viewBox="0 0 24 24" fill="none" className={active ? "text-primary" : ""}>
			<rect x="4" y="4.5" width="16" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
			<rect x="4" y="13.5" width="16" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
		</svg>
	);
}

type Layout = "stacked" | "list";

export function MessageCardsView({ cards, labels, messageId }: MessageCardsViewProps): JSX.Element | null {
	const [layout, setLayout] = useState<Layout>("stacked");
	const [activeId, setActiveId] = useState<string>(cards[0]?.id ?? "");

	if (cards.length === 0) return null;
	if (cards.length === 1) {
		return (
			<div className="flex flex-col gap-2" data-astravia-message-cards={messageId}>
				{cards[0]!.body}
			</div>
		);
	}

	const active = cards.find((c) => c.id === activeId) ?? cards[0]!;

	return (
		<div className="flex flex-col gap-2" data-astravia-message-cards={messageId}>
			<div className="flex items-center gap-2">
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
					{cards.map((card) => {
						const isActive = layout === "stacked" && card.id === active.id;
						return (
							<button
								key={card.id}
								type="button"
								onClick={() => {
									setActiveId(card.id);
									if (layout !== "stacked") setLayout("stacked");
								}}
								className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
									isActive
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted/60 hover:text-foreground/80"
								}`}
							>
								{card.icon != null && (
									<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full">
										{card.icon}
									</span>
								)}
								<span className="max-w-[120px] truncate">{card.title}</span>
								{card.pending && <span className="processing-shimmer h-1.5 w-1.5 rounded-full bg-primary" />}
							</button>
						);
					})}
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					<button
						type="button"
						title={labels.layoutStacked}
						onClick={() => setLayout("stacked")}
						className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-muted ${
							layout === "stacked" ? "text-foreground" : "text-muted-foreground"
						}`}
					>
						<span className="h-3.5 w-3.5">
							<IconStack active={layout === "stacked"} />
						</span>
					</button>
					<button
						type="button"
						title={labels.layoutList}
						onClick={() => setLayout("list")}
						className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-muted ${
							layout === "list" ? "text-foreground" : "text-muted-foreground"
						}`}
					>
						<span className="h-3.5 w-3.5">
							<IconList active={layout === "list"} />
						</span>
					</button>
				</div>
			</div>
			{layout === "stacked" ? (
				<div key={active.id}>{active.body}</div>
			) : (
				<div className="flex flex-col gap-3">
					{cards.map((card) => (
						<div key={card.id}>{card.body}</div>
					))}
				</div>
			)}
		</div>
	);
}
