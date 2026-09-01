import { cn } from "@vetta/ui";
import type { JSX, ReactNode } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { SessionDropZoneView, type SessionDropZoneViewProps } from "./SessionDropZoneView";

export interface ConversationComposerRegions {
	readonly decoration?: ReactNode;
	readonly routing?: ReactNode;
	readonly command?: ReactNode;
	readonly attachments?: ReactNode;
	readonly editor: ReactNode;
	readonly toolbar: ReactNode;
}

export interface ConversationComposerViewClassNames {
	readonly card?: string;
	readonly content?: string;
	readonly routing?: string;
	readonly command?: string;
	readonly attachments?: string;
	readonly editor?: string;
	readonly toolbar?: string;
}

export interface ConversationComposerViewProps {
	readonly focused: boolean;
	readonly topConnected?: boolean;
	readonly regions: ConversationComposerRegions;
	readonly dropZone?: Omit<SessionDropZoneViewProps, "children" | "className">;
	readonly className?: string;
	readonly classNames?: ConversationComposerViewClassNames;
}

/**
 * Host-neutral conversation composer frame. The host owns draft/editor/business state;
 * this view only renders the stable regions shared by normal and team conversations.
 */
export function ConversationComposerView({
	focused,
	topConnected = false,
	regions,
	dropZone,
	className,
	classNames,
}: ConversationComposerViewProps): JSX.Element {
	const cardClassName = cn(
		"input-card relative z-10 overflow-visible border bg-input-bar-bg shadow-[0_8px_28px_-14px_rgb(0_0_0/0.10)] transition-[border-color,box-shadow,transform] duration-200 dark:shadow-none",
		topConnected ? "rounded-b-[20px] rounded-t-none" : "rounded-[20px]",
		focused ? "border-primary/20" : "border-border",
		classNames?.card,
		className,
	);
	const content = (
		<>
			<ThemeSurface slot="chat.inputBar" />
			{regions.decoration}
			<div className={cn("relative z-10 rounded-[inherit]", classNames?.content)}>
				{regions.routing ? (
					<div className={classNames?.routing}>{regions.routing}</div>
				) : null}
				{regions.command ? (
					<div className={classNames?.command}>{regions.command}</div>
				) : null}
				{regions.attachments ? (
					<div className={classNames?.attachments}>{regions.attachments}</div>
				) : null}
				<div className={classNames?.editor}>{regions.editor}</div>
				<div className={classNames?.toolbar}>{regions.toolbar}</div>
			</div>
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
