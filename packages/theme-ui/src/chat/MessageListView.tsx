import { cn } from "@vetta/ui";
import { forwardRef, type JSX, type ReactNode } from "react";

export interface MessageListViewProps {
	/** Virtuoso instance from host (react-virtuoso is a host peer). */
	virtuoso: ReactNode;
}

/**
 * Chat message list shell. Host owns Virtuoso + itemContent (MessageItem tree).
 */
export function MessageListView({ virtuoso }: MessageListViewProps): JSX.Element {
	return (
		<>
			<style>{`
				@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
				textarea::placeholder { color: var(--muted-foreground); opacity: 0.5; }
				@keyframes context-ring-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
				@keyframes processing-shimmer { 0%, 100% { opacity: 0.58; } 50% { opacity: 1; } }
				.processing-shimmer { color: var(--foreground); animation: processing-shimmer 1.6s ease-in-out infinite; will-change: opacity; }
			`}</style>
			{virtuoso}
		</>
	);
}

export const VirtuosoListContainer = forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(function VirtuosoListContainer({ className, ...props }, ref) {
	return (
		<div
			{...props}
			ref={ref}
			className={cn(
				"mx-auto flex max-w-3xl flex-col overflow-hidden pb-2 pl-5",
				"pr-[var(--message-outline-gutter,1.25rem)]",
				className,
			)}
			style={{ ...props.style }}
		/>
	);
});
