import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";

export interface ConnectorGridProps {
	items: readonly ConnectorGridItem[];
	columns: number;
	title: string;
	onSelect: (connector: ConnectorGridItem) => void;
}

/**
 * 已接入的内置连接器宫格。
 * 列数由 connectorGridColumns 决定，目的是不让最后一行只剩一个孤立 item。
 */
export function ConnectorGrid({ items, columns, title, onSelect }: ConnectorGridProps): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<div className="px-3 pb-1 pt-2">
			<div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
				{title}
			</div>
			<div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
				{items.map((connector) => (
					<button
						key={connector.name}
						type="button"
						onClick={() => onSelect(connector)}
						title={connector.label}
						className="flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 transition-colors hover:border-primary/40 hover:bg-primary/10"
					>
						{connector.iconUrl ? (
							<img
								src={connector.iconUrl}
								alt=""
								className="h-4 w-4 shrink-0 rounded object-contain"
								draggable={false}
							/>
						) : (
							<span className="icon-[solar--plug-circle-linear] h-4 w-4 shrink-0 text-muted-foreground" />
						)}
						<span className="min-w-0 truncate text-[12px] font-medium text-foreground">{connector.label}</span>
					</button>
				))}
			</div>
		</div>
	);
}
