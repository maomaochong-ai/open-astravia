import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	type InputSegment,
	deriveAttachments,
	parseInputSegments,
	segmentsToText,
} from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { type MentionedFile, inputValueAtom, mentionedFilesAtom } from "@shared/store/atoms";
import { useStore } from "jotai";
import { useEffect, useRef } from "react";
import { stableImagePaths } from "../tokens/imagePaths";
import { inputImagePathsAtom } from "../tokens/projectionAtoms";
import { $applySegments, $readSegments } from "../tokens/segments";

type Store = ReturnType<typeof useStore>;

function samePaths(a: readonly MentionedFile[], b: readonly MentionedFile[]): boolean {
	return a.length === b.length && a.every((file, index) => file.path === b[index]?.path);
}

/**
 * 把 segments 派生出的附件投影写回 atom。
 *
 * 必须与「文本是否变化」解耦：外部清空输入框（发送后 setInputValue("")）时，
 * projectedRef 已经先被置成 ""，随后清空编辑器触发的这次提交里文本同样是 ""，
 * 若跟着文本一起早退，附件投影就永远留在上一条消息的状态——表现为发送后
 * 缩略图不消失、且因为编辑器里已无节点可删而删不掉。
 */
function syncAttachments(store: Store, segments: readonly InputSegment[]): void {
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
			if (text !== projectedRef.current) {
				projectedRef.current = text;
				store.set(inputValueAtom, text);
			}
			syncAttachments(store, segments);
		});
	}, [editor, store]);

	// 挂载时对齐一次：编辑器是新建的空文档，而 atom 里可能已经有草稿
	// （离开会话页再回来），派生态也可能是上一次挂载留下的。
	useEffect(() => {
		const initial = store.get(inputValueAtom);
		projectedRef.current = initial;
		if (initial === "") {
			syncAttachments(store, []);
			return;
		}
		editor.update(() => {
			$applySegments(parseInputSegments(initial).segments);
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
