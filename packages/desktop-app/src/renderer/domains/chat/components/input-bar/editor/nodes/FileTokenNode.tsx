import { pathTokenText } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { TokenChip } from "./TokenChip";

export type SerializedFileTokenNode = Spread<
	{ path: string; isDirectory: boolean },
	SerializedLexicalNode
>;

/** 行内文件 / 目录引用，序列化为 `@<绝对路径>`。 */
export class FileTokenNode extends DecoratorNode<JSX.Element> {
	__path: string;
	__isDirectory: boolean;

	static getType(): string {
		return "file-token";
	}

	static clone(node: FileTokenNode): FileTokenNode {
		return new FileTokenNode(node.__path, node.__isDirectory, node.__key);
	}

	constructor(path: string, isDirectory: boolean, key?: NodeKey) {
		super(key);
		this.__path = path;
		this.__isDirectory = isDirectory;
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

	isDirectory(): boolean {
		return this.__isDirectory;
	}

	static importJSON(serialized: SerializedFileTokenNode): FileTokenNode {
		return $createFileTokenNode(serialized.path, serialized.isDirectory);
	}

	exportJSON(): SerializedFileTokenNode {
		return {
			...super.exportJSON(),
			path: this.__path,
			isDirectory: this.__isDirectory,
		};
	}

	decorate(): JSX.Element {
		return (
			<TokenChip
				icon={this.__isDirectory ? "icon-[solar--folder-linear]" : "icon-[solar--file-linear]"}
				label={pathBasename(this.__path)}
				title={this.__path}
			/>
		);
	}
}

export function $createFileTokenNode(path: string, isDirectory = false): FileTokenNode {
	return new FileTokenNode(path, isDirectory);
}

export function $isFileTokenNode(node: LexicalNode | null | undefined): node is FileTokenNode {
	return node instanceof FileTokenNode;
}
