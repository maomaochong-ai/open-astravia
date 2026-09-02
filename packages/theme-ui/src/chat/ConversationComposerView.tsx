import { cn } from "@vetta/ui";
import type { JSX, ReactNode } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { SessionDropZoneView, type SessionDropZoneViewProps } from "./SessionDropZoneView";

export interface ConversationComposerRootProps {
	readonly focused: boolean;
	readonly topConnected?: boolean;
	readonly dropZone?: Omit<SessionDropZoneViewProps, "children" | "className">;
	readonly children: ReactNode;
	readonly className?: string;
}

export interface ConversationComposerPartProps {
	readonly children?: ReactNode;
	readonly className?: string;
}

/**
 * Host-neutral composer surface. Product code composes semantic children instead of
 * passing a fixed region prop bag, so adding a capability does not change this contract.
 */
export function ConversationComposerRoot({
	focused,
	topConnected = false,
	dropZone,
	children,
	className,
}: ConversationComposerRootProps): JSX.Element {
	const cardClassName = cn(
		"input-card relative z-10 overflow-visible border bg-input-bar-bg shadow-[0_8px_28px_-14px_rgb(0_0_0/0.10)] transition-[border-color,box-shadow,transform] duration-200 dark:shadow-none",
		topConnected ? "rounded-b-[20px] rounded-t-none" : "rounded-[20px]",
		focused ? "border-primary/20" : "border-border",
		className,
	);
	const content = (
		<>
			<ThemeSurface slot="chat.inputBar" />
			{children}
		</>
	);

	return dropZone ? (
		<SessionDropZoneView {...dropZone} className={cardClassName}>
			{content}
		</SessionDropZoneView>
	) : (
		<div className={cardClassName}>{content}</div>
	);
}

export function ConversationComposerDecoration({ children }: ConversationComposerPartProps): JSX.Element {
	return <>{children}</>;
}

export function ConversationComposerContent({
	children,
	className,
}: ConversationComposerPartProps): JSX.Element {
	return <div className={cn("relative z-10 rounded-[inherit]", className)}>{children}</div>;
}

function ConversationComposerRegion({
	children,
	className,
}: ConversationComposerPartProps): JSX.Element | null {
	if (children === undefined || children === null || children === false) return null;
	return <div className={className}>{children}</div>;
}

export const ConversationComposerRouting = ConversationComposerRegion;
export const ConversationComposerCommand = ConversationComposerRegion;
export const ConversationComposerAttachments = ConversationComposerRegion;
export const ConversationComposerEditor = ConversationComposerRegion;
export const ConversationComposerToolbar = ConversationComposerRegion;

/** Compound API for readable, structurally composable composer layouts. */
export const ConversationComposer = {
	Root: ConversationComposerRoot,
	Decoration: ConversationComposerDecoration,
	Content: ConversationComposerContent,
	Routing: ConversationComposerRouting,
	Command: ConversationComposerCommand,
	Attachments: ConversationComposerAttachments,
	Editor: ConversationComposerEditor,
	Toolbar: ConversationComposerToolbar,
} as const;
