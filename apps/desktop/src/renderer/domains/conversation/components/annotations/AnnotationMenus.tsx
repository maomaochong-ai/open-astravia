import { useTranslation } from "react-i18next";
import { Button } from "@shared/components/ui/button";
import type { ChatConversationItem } from "@shared/store/atoms";
import { useAnnotations } from "./AnnotationScope";

export function AnnotationMessageMarker({ message }: { message: ChatConversationItem }) {
	const annotations = useAnnotations();
	const { t } = useTranslation("chat");
	if (
		!annotations ||
		message.kind === "event" ||
		!message.entryId ||
		(message.kind === "agent" && (message.phase === "streaming" || message.phase === "pending"))
	)
		return null;
	const entryId = message.entryId;
	const notes = annotations.notes.filter((note) => note.entryId === entryId);
	if (notes.length === 0) return null;
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			title={t("annotations.saved", { count: notes.length })}
			aria-label={t("annotations.saved", { count: notes.length })}
			onClick={(event) => annotations.show(notes[0].id, event.currentTarget)}
		>
			<span className="icon-[solar--chat-round-dots-linear] h-3.5 w-3.5" />
		</Button>
	);
}
