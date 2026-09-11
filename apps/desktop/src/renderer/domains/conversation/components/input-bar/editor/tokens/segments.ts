import type { InputSegment } from "@shared/lib/input-tokens";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isLineBreakNode,
	$isRangeSelection,
	$isTextNode,
	type LexicalNode,
} from "lexical";
import {
	$createConnectorTokenNode,
	$createFileTokenNode,
	$createImageTokenNode,
	$createMemberTokenNode,
	$createSceneTokenNode,
	$createSkillTokenNode,
	$isConnectorTokenNode,
	$isFileTokenNode,
	$isImageTokenNode,
	$isMemberTokenNode,
	$isSkillTokenNode,
} from "../nodes";

function pushText(out: InputSegment[], text: string): void {
	if (text === "") return;
	const last = out[out.length - 1];
	if (last?.kind === "text") {
		last.text += text;
		return;
	}
	out.push({ kind: "text", text });
}

function collect(node: LexicalNode, out: InputSegment[]): void {
	if ($isSkillTokenNode(node)) {
		out.push({
			kind: node.getAbilityType(),
			name: node.getName(),
			...(node.getAlias() ? { alias: node.getAlias() } : {}),
			...(node.getIcon() ? { icon: node.getIcon() } : {}),
		});
		return;
	}
	if ($isConnectorTokenNode(node)) {
		out.push({
			kind: "connector",
			name: node.getName(),
			label: node.getLabel(),
			...(node.getIconUrl() ? { iconUrl: node.getIconUrl() } : {}),
		});
		return;
	}
	if ($isFileTokenNode(node)) {
		out.push({ kind: "file", path: node.getPath(), isDirectory: node.isDirectory() });
		return;
	}
	if ($isImageTokenNode(node)) {
		out.push({ kind: "image", path: node.getPath() });
		return;
	}
	if ($isMemberTokenNode(node)) {
		out.push({
			kind: "member",
			memberId: node.getMemberId(),
			handle: node.getHandle(),
			label: node.getLabel(),
			...(node.getAvatar() ? { avatar: node.getAvatar() } : {}),
			...(node.getMeta() ? { meta: node.getMeta() } : {}),
		});
		return;
	}
	if ($isLineBreakNode(node)) {
		pushText(out, "\n");
		return;
	}
	if ($isTextNode(node)) {
		pushText(out, node.getTextContent());
		return;
	}
	if ($isElementNode(node)) {
		for (const child of node.getChildren()) collect(child, out);
	}
}

/** 读出当前编辑器内容的 segments 表示。须在 editor.read / editor.update 内调用。 */
export function $readSegments(): InputSegment[] {
	const out: InputSegment[] = [];
	const paragraphs = $getRoot().getChildren();
	paragraphs.forEach((paragraph, index) => {
		// 输入框语义是「单段 + 软换行」；真出现多段时按换行拼接，不丢内容。
		if (index > 0) pushText(out, "\n");
		collect(paragraph, out);
	});
	return out;
}

/**
 * Read the current range without flattening atomic tokens to their wire text.
 * Text nodes at either edge are sliced to the exact selected offsets; token
 * nodes keep the identity and presentation metadata needed for a lossless paste.
 */
export function $readSelectedSegments(): InputSegment[] {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || selection.isCollapsed()) return [];
	const [anchor, focus] = selection.getStartEndPoints();
	const [start, end] = selection.isBackward() ? [focus, anchor] : [anchor, focus];
	const out: InputSegment[] = [];
	for (const node of selection.getNodes()) {
		if ($isTextNode(node)) {
			const text = node.getTextContent();
			const from = start.type === "text" && start.key === node.getKey() ? start.offset : 0;
			const to = end.type === "text" && end.key === node.getKey() ? end.offset : text.length;
			pushText(out, text.slice(from, to));
			continue;
		}
		if (
			$isSkillTokenNode(node) ||
			$isConnectorTokenNode(node) ||
			$isFileTokenNode(node) ||
			$isImageTokenNode(node) ||
			$isMemberTokenNode(node) ||
			$isLineBreakNode(node)
		) {
			collect(node, out);
		}
	}
	return out;
}

function segmentNodes(segment: InputSegment): LexicalNode[] {
	switch (segment.kind) {
		case "member":
			return [$createMemberTokenNode(segment.memberId, segment.handle, segment.label, segment.avatar, segment.meta)];
		case "scene":
			return [$createSceneTokenNode(segment.name, segment.alias, segment.icon)];
		case "skill":
			return [$createSkillTokenNode(segment.name, segment.alias, segment.icon)];
		case "connector":
			// 从旧文本还原时拿不到展示名与 logo，用真实名兜底；结构化来源保留完整展示信息。
			return [$createConnectorTokenNode(segment.name, segment.label ?? segment.name, segment.iconUrl)];
		case "file":
			return [$createFileTokenNode(segment.path, segment.isDirectory ?? false)];
		case "image":
			return [$createImageTokenNode(segment.path)];
		case "text": {
			const nodes: LexicalNode[] = [];
			const lines = segment.text.split("\n");
			lines.forEach((line, index) => {
				if (index > 0) nodes.push($createLineBreakNode());
				if (line !== "") nodes.push($createTextNode(line));
			});
			return nodes;
		}
	}
}

/** 用 segments 整体替换编辑器内容（外部写入 / 重编辑回填走这里）。 */
export function $applySegments(segments: readonly InputSegment[]): void {
	const root = $getRoot();
	root.clear();
	const paragraph = $createParagraphNode();
	for (const segment of segments) paragraph.append(...segmentNodes(segment));
	root.append(paragraph);
	paragraph.selectEnd();
}

/** Insert a structured segment range at the current selection without reparsing wire text. */
export function $insertSegments(segments: readonly InputSegment[]): void {
	const nodes = segments.flatMap(segmentNodes);
	if (nodes.length === 0) return;
	const selection = $getSelection();
	if ($isRangeSelection(selection)) {
		selection.insertNodes(nodes);
		return;
	}
	const paragraph = $getRoot().getLastChild();
	if ($isElementNode(paragraph)) {
		paragraph.append(...nodes);
		paragraph.selectEnd();
	}
}

/**
 * 在光标处插入一个 token，并保证它后面紧跟一个空格——
 * 相邻 token 之间没有空白时 `@a@b` 无法被 parseInputSegments 回读。
 */
export function $insertTokenNodes(nodes: readonly LexicalNode[]): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		const paragraph = $getRoot().getLastChild();
		if ($isElementNode(paragraph)) {
			paragraph.append(...nodes, $createTextNode(" "));
			paragraph.selectEnd();
		}
		return;
	}
	selection.insertNodes([...nodes]);
	const after = $getSelection();
	if (!$isRangeSelection(after)) return;
	const anchorNode = after.anchor.getNode();
	const followingText = anchorNode.getNextSibling();
	const alreadySpaced =
		$isTextNode(anchorNode) && /\s$/.test(anchorNode.getTextContent().slice(0, after.anchor.offset));
	if (alreadySpaced) return;
	if ($isTextNode(followingText) && /^\s/.test(followingText.getTextContent())) return;
	after.insertNodes([$createTextNode(" ")]);
}
