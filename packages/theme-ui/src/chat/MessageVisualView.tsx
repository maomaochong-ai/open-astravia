import { cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import { forwardRef } from "react";
import type { MessagePrimitiveProps } from "./MessageView";
import { useMessageRootContext } from "./MessageView";

export const MessageVisualOutgoingBubble = createMessageVisual(
	"OutgoingBubble",
	"min-w-0 max-w-full rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[14px] leading-[1.6] text-foreground data-[pending=true]:opacity-70",
);
export const MessageVisualEventBubble = createMessageVisual(
	"EventBubble",
	"inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/55 px-3 py-1 text-[11px] text-muted-foreground",
);

function createMessageVisual(name: string, baseClassName: string) {
	return forwardRef<HTMLDivElement, MessagePrimitiveProps>(function MessageVisualPart(
		{ asChild = false, children, className, ...props },
		forwardedRef,
	) {
		const { pending } = useMessageRootContext(`MessageVisual.${name}`);
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn(baseClassName, className)}
				data-message-visual={name.toLowerCase()}
				data-pending={pending || undefined}
				{...props}
			>
				{children}
			</Comp>
		);
	});
}

export const MessageVisual = {
	OutgoingBubble: MessageVisualOutgoingBubble,
	EventBubble: MessageVisualEventBubble,
} as const;
