export function InputBarSpeechStatus({ text }: { text: string }): JSX.Element {
	return (
		<div
			className="mx-3 truncate rounded-b-lg border-x border-b border-border/70 bg-card/80 px-2.5 py-1 text-[11px] text-muted-foreground"
			role="status"
		>
			{text}
		</div>
	);
}
