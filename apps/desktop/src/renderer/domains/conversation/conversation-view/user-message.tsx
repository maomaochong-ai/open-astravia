import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { MessageLayout } from "@vetta-org/theme-ui/chat/MessageLayoutView";
import { UserMessage as UserMessagePrimitive } from "@vetta-org/theme-ui/chat/UserMessageView";
import { UserMessageContextMenuView } from "@vetta-org/theme-ui/chat/UserMessageContextMenuView";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CopyButton } from "../components/message-list/MessageActions";
import { UserMessage as UserMessageContent } from "../components/message-list/UserMessage";
import { projectUserMessage } from "../components/message-list/userMessageProjection";
import { useUserMessageContextMenu, useUserMessageCopyAction } from "../hooks/userMessageMenu";
import { type UserMessageCommands, useConversationCapability, useConversationFeed } from "./feed";
import { useMessageRow } from "./message-scope";

type Projection = ReturnType<typeof projectUserMessage>;

/** Context-menu entries offered by the action parts placed in this message's template. */
interface UserMessageMenuCommands {
	readonly copy?: () => Promise<void>;
	readonly edit?: () => void;
	readonly delete?: () => void;
}

interface UserMessageState {
	readonly message: ConversationUserMessageViewModel;
	readonly isLastUserMessage: boolean;
	readonly projection: Projection;
	readonly hovered: boolean;
	readonly pinned: boolean;
	readonly offer: (name: keyof UserMessageMenuCommands, command: (() => unknown) | undefined) => void;
	readonly pin: (reason: string, pinned: boolean) => void;
	readonly setPending: (pending: boolean) => void;
}

const UserMessageContext = createContext<UserMessageState | null>(null);

function useUserMessageState(part: string): UserMessageState {
	const state = useContext(UserMessageContext);
	if (!state) throw new Error(`${part} must be rendered inside <UserMessage.Root>`);
	return state;
}

/**
 * The user's bubble (text, images, attachments). Its children render under the
 * bubble; action parts placed there also decide what the context menu offers.
 */
function UserMessageRoot({ children }: { readonly children?: ReactNode }) {
	const row = useMessageRow("UserMessage.Root");
	const { participants } = useConversationFeed("UserMessage.Root");
	const message = row.message.kind === "user" ? row.message : null;
	const projection = useMemo(() => (message ? projectUserMessage(message) : null), [message]);
	const [hovered, setHovered] = useState(false);
	const [pins, setPins] = useState<ReadonlySet<string>>(() => new Set());
	const [pending, setPending] = useState(false);
	const [commands, setCommands] = useState<UserMessageMenuCommands>({});
	const offer = useCallback((name: keyof UserMessageMenuCommands, command: (() => unknown) | undefined) => {
		setCommands((previous) => (previous[name] === command ? previous : { ...previous, [name]: command }));
	}, []);
	const pin = useCallback((reason: string, pinned: boolean) => {
		setPins((previous) => {
			if (previous.has(reason) === pinned) return previous;
			const next = new Set(previous);
			if (pinned) next.add(reason);
			else next.delete(reason);
			return next;
		});
	}, []);
	const menu = useUserMessageContextMenu({
		canCopy: Boolean(commands.copy),
		canDelete: Boolean(commands.delete),
		canEdit: Boolean(commands.edit),
		onCopy: commands.copy ?? (async () => undefined),
		onDelete: commands.delete ?? (() => undefined),
		onEdit: commands.edit ?? (() => undefined),
	});
	const state = useMemo<UserMessageState | null>(
		() =>
			message && projection
				? {
						message,
						isLastUserMessage: row.isLastUserMessage,
						projection,
						hovered,
						pinned: pins.size > 0,
						offer,
						pin,
						setPending,
					}
				: null,
		[message, projection, row.isLastUserMessage, hovered, pins, offer, pin],
	);
	if (!message || !state) return null;
	return (
		<UserMessageContext.Provider value={state}>
			<UserMessageContent
				message={message}
				participants={participants}
				pending={pending}
				onContextMenu={menu.onContextMenu}
				onActionsVisibleChange={setHovered}
			>
				{children}
			</UserMessageContent>
			{menu.model ? createPortal(<UserMessageContextMenuView {...menu.model} />, document.body) : null}
		</UserMessageContext.Provider>
	);
}

/** Actions under the bubble: shown on hover, or while an action needs attention. */
function UserMessageActions({ children }: { readonly children?: ReactNode }) {
	const { hovered, pinned } = useUserMessageState("UserMessage.Actions");
	return (
		<MessageLayout.Footer asChild>
			<div
				className={`flex-col items-end gap-0.5 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 [&:not(:has(>:not(:empty)))]:hidden ${hovered || pinned ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
			>
				{children}
			</div>
		</MessageLayout.Footer>
	);
}

/** One row of action buttons; collapses when none of its actions apply. */
function UserMessageActionBar({ children }: { readonly children?: ReactNode }) {
	return <UserMessagePrimitive.ActionBar>{children}</UserMessagePrimitive.ActionBar>;
}

function UserMessageCopyAction() {
	const { projection, offer } = useUserMessageState("UserMessage.CopyAction");
	const copy = useUserMessageCopyAction(projection.copyText, projection.copyImageSources);
	const canCopy = Boolean(projection.copyText || projection.copyImageSources.length > 0);
	useLayoutEffect(() => {
		offer("copy", canCopy ? copy : undefined);
		return () => offer("copy", undefined);
	}, [canCopy, copy, offer]);
	return canCopy ? <CopyButton getText={() => projection.copyText} onCopy={copy} /> : null;
}

/** Mounts `Command` only when the feed offers user message commands. */
function withCommands(Command: (props: { readonly commands: UserMessageCommands }) => JSX.Element | null) {
	return function UserMessageCommandPart() {
		const commands = useConversationCapability("userMessageCommands");
		return commands ? <Command commands={commands} /> : null;
	};
}

const UserMessageEditAction = withCommands(function EditAction({ commands }) {
	const { t } = useTranslation("chat");
	const { message, isLastUserMessage, offer, pin, setPending } = useUserMessageState("UserMessage.EditAction");
	const edit = commands.useEdit(message, isLastUserMessage);
	useLayoutEffect(() => {
		offer("edit", edit.available ? edit.onEdit : undefined);
		pin("edit", edit.pending);
		setPending(edit.pending);
		return () => {
			offer("edit", undefined);
			pin("edit", false);
			setPending(false);
		};
	}, [edit.available, edit.onEdit, edit.pending, offer, pin, setPending]);
	if (!edit.available) return null;
	return (
		<UserMessagePrimitive.Action
			onClick={edit.onEdit}
			title={edit.pending ? t("messageList.edit.pendingHint") : t("messageList.editButton")}
			aria-label={t("messageList.editButton")}
			className={edit.pending ? "text-primary" : undefined}
		>
			<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
		</UserMessagePrimitive.Action>
	);
});

const UserMessageForkAction = withCommands(function ForkAction({ commands }) {
	const { t } = useTranslation("chat");
	const { message } = useUserMessageState("UserMessage.ForkAction");
	const history = commands.useHistory(message);
	if (!history.forkAvailable) return null;
	return (
		<UserMessagePrimitive.Action
			onClick={history.onFork}
			title={t("messageList.forkButton")}
			aria-label={t("messageList.forkButton")}
		>
			<span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" />
		</UserMessagePrimitive.Action>
	);
});

/** Previous / next sibling branch; stays visible while the message has siblings. */
const UserMessageBranchSwitcher = withCommands(function BranchSwitcher({ commands }) {
	const { t } = useTranslation("chat");
	const { message, pin } = useUserMessageState("UserMessage.BranchSwitcher");
	const history = commands.useHistory(message);
	useLayoutEffect(() => {
		pin("branch", history.canSwitch);
		return () => pin("branch", false);
	}, [history.canSwitch, pin]);
	if (!history.canSwitch) return null;
	return (
		<UserMessagePrimitive.BranchSwitcher
			index={history.branchIndex}
			total={history.branchTotal}
			onPrevious={history.onPrevious}
			onNext={history.onNext}
			labels={{
				previous: t("messageList.branch.prev"),
				next: t("messageList.branch.next"),
				position: t("messageList.branch.position", {
					current: history.branchIndex + 1,
					total: history.branchTotal,
				}),
			}}
		/>
	);
});

/** Offers "delete" in the context menu; it has no button of its own. */
const UserMessageDeleteCommand = withCommands(function DeleteCommand({ commands }) {
	const { message, offer } = useUserMessageState("UserMessage.DeleteCommand");
	const remove = commands.useDelete(message);
	useLayoutEffect(() => {
		offer("delete", remove.available ? remove.onDelete : undefined);
		return () => offer("delete", undefined);
	}, [remove.available, remove.onDelete, offer]);
	return null;
});

/** Parts for `<Conversation.UserMessage>` templates (ADR-0147). */
export const UserMessage = {
	Root: UserMessageRoot,
	Actions: UserMessageActions,
	ActionBar: UserMessageActionBar,
	CopyAction: UserMessageCopyAction,
	EditAction: UserMessageEditAction,
	ForkAction: UserMessageForkAction,
	BranchSwitcher: UserMessageBranchSwitcher,
	DeleteCommand: UserMessageDeleteCommand,
} as const;

/** The message and editor state of the enclosing `<UserMessage.Root>`, for custom parts. */
export function useUserMessage(): ConversationUserMessageViewModel {
	return useUserMessageState("useUserMessage").message;
}
