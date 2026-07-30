import { pathTokenText } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { useAtomValue } from "jotai";
import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { useTranslation } from "react-i18next";
import { inputImagePathsAtom } from "../tokens/projectionAtoms";
import { TokenChip } from "./TokenChip";

export type SerializedImageTokenNode = Spread<{ path: string }, SerializedLexicalNode>;

/**
 * 行内图片引用渲染成「图 N」胶囊，真正的缩略图在输入卡片上方的附件行里。
 *
 * 编号从 inputImagePathsAtom 读而不是记在节点上：在前面插入一张图会让后面
 * 所有图片的序号改变，而 decorate 只在节点自身 dirty 时重跑，写死就会错号。
 */
function ImageTokenView({ path }: { path: string }): JSX.Element {
	const { t } = useTranslation("chat");
	const paths = useAtomValue(inputImagePathsAtom);
	const index = paths.indexOf(path);
	return (
		<TokenChip
			icon="icon-[solar--gallery-linear]"
			label={t("inputBar.capsule.imageBadge", { index: (index === -1 ? paths.length : index) + 1 })}
			title={pathBasename(path)}
		/>
	);
}

export class ImageTokenNode extends DecoratorNode<JSX.Element> {
	__path: string;

	static getType(): string {
		return "image-token";
	}

	static clone(node: ImageTokenNode): ImageTokenNode {
		return new ImageTokenNode(node.__path, node.__key);
	}

	constructor(path: string, key?: NodeKey) {
		super(key);
		this.__path = path;
	}

	createDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "align-middle";
		return span;
	}

	updateDOM(): false {
		return false;
	}

	isInline(): true {
		return true;
	}

	isKeyboardSelectable(): true {
		return true;
	}

	getTextContent(): string {
		return pathTokenText(this.__path);
	}

	getPath(): string {
		return this.__path;
	}

	static importJSON(serialized: SerializedImageTokenNode): ImageTokenNode {
		return $createImageTokenNode(serialized.path);
	}

	exportJSON(): SerializedImageTokenNode {
		return { ...super.exportJSON(), path: this.__path };
	}

	decorate(): JSX.Element {
		return <ImageTokenView path={this.__path} />;
	}
}

export function $createImageTokenNode(path: string): ImageTokenNode {
	return new ImageTokenNode(path);
}

export function $isImageTokenNode(node: LexicalNode | null | undefined): node is ImageTokenNode {
	return node instanceof ImageTokenNode;
}
