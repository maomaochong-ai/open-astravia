import { cn } from "@vetta-org/ui";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { ProviderIcon } from "../shared/provider-icon";

interface ModelSelectorTriggerProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
	readonly label: string;
	readonly icon?: string;
	readonly reasoningLabel?: string;
}

/** Shared input-bar model trigger; each picker keeps its own menu behavior. */
export const ModelSelectorTrigger = forwardRef<HTMLButtonElement, ModelSelectorTriggerProps>(
	function ModelSelectorTrigger({ label, icon, reasoningLabel, className, title, ...props }, ref) {
		return (
			<button
				ref={ref}
				type="button"
				title={title ?? label}
				className={cn(
					// The input bar is a CSS container: truncate the name before wrapping its toolbar.
					"flex min-w-0 max-w-[5.5rem] items-center gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[11px] text-foreground transition-colors focus:outline-none focus-visible:outline-none data-[state=open]:bg-accent/60 data-[state=open]:text-foreground @[22rem]:max-w-[9rem] @[28rem]:max-w-[13rem]",
					className,
				)}
				{...props}
			>
				<ProviderIcon symbol={icon} className="h-3 w-3 shrink-0" />
				<span className="min-w-0 flex-1 truncate text-left">{label}</span>
				{reasoningLabel ? (
					<span className="hidden shrink-0 rounded bg-muted/70 px-1 text-[9px] leading-[14px] text-muted-foreground @[28rem]:inline">
						{reasoningLabel}
					</span>
				) : null}
				<span aria-hidden="true" className="icon-[solar--alt-arrow-down-linear] h-2.5 w-2.5 shrink-0" />
			</button>
		);
	},
);
