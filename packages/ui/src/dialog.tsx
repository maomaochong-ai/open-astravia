import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn, OVERLAY_BACKDROP_CLASS, PANEL_SHADOW_CLASS } from "./utils";
import { Button } from "./button";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn(
				"no-drag fixed inset-0 isolate z-50",
				OVERLAY_BACKDROP_CLASS,
				className,
			)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	overlayClassName,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	overlayClassName?: string;
	showCloseButton?: boolean;
}) {
	return (
		<DialogPortal>
			<DialogOverlay className={overlayClassName} />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				onOpenAutoFocus={(e) => e.preventDefault()}
				className={cn(
					// Single max-width (not max-w + sm:max-w-sm): avoids twMerge leaving
					// sm:max-w-sm that overrides consumer max-w-lg at the sm breakpoint.
					// 不用外边框，靠留白和柔和投影区分层次。
					"no-drag fixed top-1/2 left-1/2 z-50 grid w-full max-w-[min(24rem,calc(100%-2rem))] [transform:translate(-50%,-50%)] gap-5 rounded-2xl bg-popover p-6 text-sm text-popover-foreground outline-none",
					PANEL_SHADOW_CLASS,
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close data-slot="dialog-close" asChild>
						<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm">
							<XIcon />
							<span className="sr-only">Close</span>
						</Button>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean;
}) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				// 通栏底栏：一条淡分隔线 + 比正文略深的底色，把操作区托出来。
				// 负外边距抵消 DialogContent 的 p-6，让它贴到面板边缘。
				"-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-2xl border-t border-border/50 bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close asChild>
					<Button variant="outline">Close</Button>
				</DialogPrimitive.Close>
			)}
		</div>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("text-[17px] leading-snug font-semibold tracking-tight", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(
				"text-[13px] leading-relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
