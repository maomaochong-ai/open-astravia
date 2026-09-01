import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
} from "lexical";
import { type JSX, type MouseEvent, type ReactNode, useEffect, useRef } from "react";

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 140;
const CONTROLLED_SYNC_TAG = "conversation-editor-controlled-sync";

type ControlledEditorProps =
	| {
			readonly value: string;
			readonly onValueChange: (value: string) => void;
	  }
	| {
			readonly value?: never;
			readonly onValueChange?: never;
	  };

export type ConversationEditorViewProps = ControlledEditorProps & {
	readonly namespace: string;
	readonly ariaLabel: string;
	readonly editable: boolean;
	readonly nodes?: InitialConfigType["nodes"];
	readonly plugins?: ReactNode;
	readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
	readonly onEnter: () => boolean;
	readonly onFocusChange: (focused: boolean) => void;
};

/** Shared Lexical editor surface. Domain adapters own state, tokens and optional plugins. */
export function ConversationEditorView({
	namespace,
	ariaLabel,
	editable,
	nodes,
	plugins,
	value,
	onValueChange,
	onContextMenu,
	onEnter,
	onFocusChange,
}: ConversationEditorViewProps): JSX.Element {
	return (
		<LexicalComposer
			initialConfig={{
				namespace,
				...(nodes ? { nodes } : {}),
				editable,
				onError: (error) => console.error("[conversation-editor]", error),
				theme: {},
			}}
		>
			<PlainTextPlugin
				contentEditable={
					<ContentEditable
						aria-label={ariaLabel}
						className="w-full resize-none whitespace-pre-wrap break-words bg-transparent text-[13.5px] leading-[1.6] text-foreground outline-none data-[editable=false]:cursor-not-allowed"
						style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, overflowY: "auto" }}
						onFocus={() => onFocusChange(true)}
						onBlur={() => onFocusChange(false)}
						onContextMenu={onContextMenu}
					/>
				}
				placeholder={null}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<HistoryPlugin />
			<EditableStatePlugin editable={editable} />
			{value !== undefined && onValueChange ? (
				<ControlledTextPlugin value={value} onValueChange={onValueChange} />
			) : null}
			<SubmitPlugin onEnter={onEnter} />
			{plugins}
		</LexicalComposer>
	);
}

function EditableStatePlugin({ editable }: { readonly editable: boolean }): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		editor.setEditable(editable);
	}, [editable, editor]);

	return null;
}

function ControlledTextPlugin({
	value,
	onValueChange,
}: {
	readonly value: string;
	readonly onValueChange: (value: string) => void;
}): null {
	const [editor] = useLexicalComposerContext();
	const onValueChangeRef = useRef(onValueChange);
	const projectedValueRef = useRef(value);
	onValueChangeRef.current = onValueChange;

	useEffect(
		() =>
			editor.registerUpdateListener(({ editorState, tags }) => {
				if (tags.has(CONTROLLED_SYNC_TAG)) return;
				const next = editorState.read(() => $getRoot().getTextContent());
				if (next === projectedValueRef.current) return;
				projectedValueRef.current = next;
				onValueChangeRef.current(next);
			}),
		[editor],
	);

	useEffect(() => {
		projectedValueRef.current = value;
		const current = editor.getEditorState().read(() => $getRoot().getTextContent());
		if (current === value) return;
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const paragraph = $createParagraphNode();
				const lines = value.split("\n");
				for (let index = 0; index < lines.length; index += 1) {
					if (index > 0) paragraph.append($createLineBreakNode());
					const line = lines[index];
					if (line) paragraph.append($createTextNode(line));
				}
				root.append(paragraph);
			},
			{ tag: CONTROLLED_SYNC_TAG },
		);
	}, [editor, value]);

	return null;
}

function SubmitPlugin({ onEnter }: { readonly onEnter: () => boolean }): null {
	const [editor] = useLexicalComposerContext();
	const onEnterRef = useRef(onEnter);
	onEnterRef.current = onEnter;

	useEffect(
		() =>
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (event === null || event.shiftKey || event.isComposing) return false;
					if (!onEnterRef.current()) return false;
					event.preventDefault();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor],
	);

	return null;
}
