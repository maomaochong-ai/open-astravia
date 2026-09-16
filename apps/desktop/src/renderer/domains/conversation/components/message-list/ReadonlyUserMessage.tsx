import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { MessageLayout, UserMessageContextMenuView } from "@vetta-org/theme-ui/chat";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useUserMessageContextMenu, useUserMessageCopyAction } from "../../hooks/useUserMessageActions";
import { CopyButton } from "./MessageActions";
import { projectUserMessage } from "./userMessageProjection";
import { UserMessage } from "./UserMessage";
import type { UserMessageProps } from "./UserMessage";

export function UserMessageCopyAction({ message }: { message: ConversationUserMessageViewModel }) {
	const projection = useMemo(() => projectUserMessage(message), [message]);
	const copy = useUserMessageCopyAction(projection.copyText, projection.copyImageSources);
	if (!projection.copyText && projection.copyImageSources.length === 0) return null;
	return <CopyButton getText={() => projection.copyText} onCopy={copy} />;
}

export function ReadonlyUserMessage({ message, participants }: Pick<UserMessageProps, "message" | "participants">) {
	const projection = useMemo(() => projectUserMessage(message), [message]);
	const onCopy = useUserMessageCopyAction(projection.copyText, projection.copyImageSources);
	const canCopy = Boolean(projection.copyText || projection.copyImageSources.length);
	const [actionsVisible, setActionsVisible] = useState(false);
	const menu = useUserMessageContextMenu({
		canCopy,
		canDelete: false,
		canEdit: false,
		onCopy,
		onDelete: () => undefined,
		onEdit: () => undefined,
	});
	return (
		<>
			<UserMessage
				message={message}
				participants={participants}
				onContextMenu={menu.onContextMenu}
				onActionsVisibleChange={setActionsVisible}
			>
				{canCopy ? (
					<MessageLayout.Footer
						className={`justify-end transition-opacity duration-150 ${actionsVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
					>
						<CopyButton getText={() => projection.copyText} onCopy={onCopy} />
					</MessageLayout.Footer>
				) : null}
			</UserMessage>
			{menu.model ? createPortal(<UserMessageContextMenuView {...menu.model} />, document.body) : null}
		</>
	);
}
