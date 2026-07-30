import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { deriveAttachments, parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { type MentionedFile, inputValueAtom, mentionedFilesAtom } from "@shared/store/atoms";
import { useStore } from "jotai";
import { useEffect, useRef } from "react";
import { $applySegments, $readSegments } from "../tokens/segments";
import { stableImagePaths } from "../tokens/imagePaths";
import { inputImagePathsAtom } from "../tokens/projectionAtoms";

function samePaths(a: readonly MentionedFile[], b: readonly MentionedFile[]): boolean {
	return a.length === b.length && a.every((file, index) => file.path === b[index]?.path);
}

/**
 * EditorState ↔ atom 投影。
 *
 * 编辑器是真相源：每次变更把序列化文本写回 inputValueAtom，并同步派生
 * mentionedFilesAtom / inputImagePathsAtom，使发送链路的读取端一行不用改。
 * 反方向只在「外部写入的值 ≠ 自己刚投影出去的值」时触发，避免回环与光标跳回。
 *
 * 全程走 store.sub 而不是 useAtomValue：本组件自己就是 inputValueAtom 的写入方，
 * 订阅它会让每敲一个字符都多一次 React 渲染，纯属自找的开销。
 * 派生值写入前都做等价判断——引用不变，订阅方就不会被逐字符唤醒。
 */
export function ValueBridgePlugin(): null {
	const [editor] = useLexicalComposerContext();
	const store = useStore();
	const projectedRef = useRef("");

	useEffect(() => {
		return editor.registerUpdateListener(({ editorState }) => {
			const segments = editorState.read(() => $readSegments());
			const text = segmentsToText(segments);
			if (text === projectedRef.current) return;
			projectedRef.current = text;
			store.set(inputValueAtom, text);

			const attachments = deriveAttachments(segments);
			const files: MentionedFile[] = attachments.map((attachment) => ({
				path: attachment.path,
				name: pathBasename(attachment.path),
				isDirectory: attachment.kind === "directory",
			}));
			if (!samePaths(store.get(mentionedFilesAtom), files)) store.set(mentionedFilesAtom, files);

			const imagePaths = stableImagePaths(
				attachments.flatMap((attachment) => (attachment.kind === "image" ? [attachment.path] : [])),
			);
			if (store.get(inputImagePathsAtom) !== imagePaths) store.set(inputImagePathsAtom, imagePaths);
		});
	}, [editor, store]);

	useEffect(() => {
		return store.sub(inputValueAtom, () => {
			const next = store.get(inputValueAtom);
			if (next === projectedRef.current) return;
			projectedRef.current = next;
			editor.update(() => {
				$applySegments(parseInputSegments(next).segments);
			});
		});
	}, [editor, store]);

	return null;
}
