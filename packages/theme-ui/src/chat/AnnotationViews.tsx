import { Button } from "@vetta-org/ui";
import { useId } from "react";
import type { ReactNode } from "react";

export function AnnotationComposer({
	value,
	pending,
	labels,
	onChange,
	onSend,
	onCancel,
}: {
	value: string;
	pending: boolean;
	labels: { question: string; send: string; cancel: string };
	onChange(value: string): void;
	onSend(): void;
	onCancel(): void;
}) {
	const id = useId();
	return (
		<form
			className="flex flex-col gap-2 border-t border-border pt-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSend();
			}}
		>
			<label htmlFor={id} className="text-[12px] text-muted-foreground">
				{labels.question}
			</label>
			<textarea
				id={id}
				value={value}
				maxLength={20000}
				rows={3}
				onChange={(event) => onChange(event.target.value)}
				className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
			/>
			<div className="flex justify-end gap-2">
				{pending ? (
					<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
						{labels.cancel}
					</Button>
				) : null}
				<Button type="submit" size="sm" disabled={pending || !value.trim()}>
					{labels.send}
				</Button>
			</div>
		</form>
	);
}

export function AnnotationTurnView({ question, children }: { question: string; children: ReactNode }) {
	return (
		<article className="flex flex-col gap-2 py-3 text-[13px]">
			<p className="whitespace-pre-wrap break-words font-medium">{question}</p>
			{children}
		</article>
	);
}

export function AnnotationHistoryView({
	items,
	query,
	labels,
	onQueryChange,
	onOpen,
}: {
	items: readonly { id: string; quote: string; title: string }[];
	query: string;
	labels: { search: string; empty: string };
	onQueryChange(value: string): void;
	onOpen(id: string): void;
}) {
	const id = useId();
	return (
		<div className="flex min-h-0 flex-col gap-3">
			<label className="sr-only" htmlFor={id}>
				{labels.search}
			</label>
			<input
				id={id}
				type="search"
				value={query}
				placeholder={labels.search}
				onChange={(event) => onQueryChange(event.target.value)}
				className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
			/>
			<ul className="max-h-[50vh] overflow-auto">
				{items.map((item) => (
					<li key={item.id}>
						<button
							type="button"
							onClick={() => onOpen(item.id)}
							className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:outline-1 focus-visible:outline-ring"
						>
							<span className="line-clamp-2 text-[13px]">{item.title}</span>
							<span className="line-clamp-1 text-[11px] text-muted-foreground">{item.quote}</span>
						</button>
					</li>
				))}
			</ul>
			{items.length === 0 ? <p className="py-3 text-[13px] text-muted-foreground">{labels.empty}</p> : null}
		</div>
	);
}
