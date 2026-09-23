import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from "@shared/components/ui/dropdown-menu";
import type { ChatConversationItem } from "@shared/store/atoms";
import { useAnnotations } from "./AnnotationScope";

export function AnnotationMessageMenu({ message }: { message: ChatConversationItem }) {
	const annotations = useAnnotations();
	const { t } = useTranslation("chat");
	const origin = useRef<HTMLButtonElement>(null);
	if (
		!annotations ||
		message.kind === "event" ||
		!message.entryId ||
		(message.kind === "agent" && (message.phase === "streaming" || message.phase === "pending"))
	)
		return null;
	const entryId = message.entryId;
	const quote =
		message.kind === "user"
			? message.text
			: (message.text ??
				message.blocks
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("\n"));
	const notes = annotations.notes.filter((note) => note.entryId === entryId);
	return (
		<div className="flex items-center gap-1">
			{notes.length > 0 ? (
				<Button
					variant="ghost"
					size="icon-sm"
					title={t("annotations.saved", { count: notes.length })}
					aria-label={t("annotations.saved", { count: notes.length })}
					onClick={(event) => annotations.show(notes[0].id, event.currentTarget)}
				>
					<span className="icon-[solar--chat-round-dots-linear] h-3.5 w-3.5" />
				</Button>
			) : null}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={origin} variant="ghost" size="icon-sm" aria-label={t("annotations.messageMenu")}>
						<span className="icon-[solar--menu-dots-linear] h-3.5 w-3.5" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
					<DropdownMenuItem onSelect={() => annotations.ask(entryId, quote.slice(0, 20000), origin.current)}>
						<span aria-hidden="true" className="icon-[solar--chat-round-dots-linear] h-3.5 w-3.5" />
						{t("annotations.ask")}
					</DropdownMenuItem>
					{notes.map((note) => (
						<DropdownMenuItem key={note.id} onSelect={() => annotations.show(note.id, origin.current)}>
							<span className="max-w-64 truncate">{note.turns[0]?.question}</span>
						</DropdownMenuItem>
					))}
					<DropdownMenuItem onSelect={() => annotations.history(origin.current)}>
						{t("annotations.history")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
