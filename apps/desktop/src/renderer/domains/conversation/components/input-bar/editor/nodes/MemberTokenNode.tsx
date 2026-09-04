import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { TokenChip } from "./TokenChip";

export type SerializedMemberTokenNode = Spread<
	{ handle: string; label: string; avatar?: string; meta?: string },
	SerializedLexicalNode
>;

/** A selected Team member mention. The serialized text remains the regular @handle form. */
export class MemberTokenNode extends DecoratorNode<JSX.Element> {
	__handle: string;
	__label: string;
	__avatar?: string;
	__meta?: string;

	static getType(): string {
		return "member-token";
	}

	static clone(node: MemberTokenNode): MemberTokenNode {
		return new MemberTokenNode(node.__handle, node.__label, node.__avatar, node.__meta, node.__key);
	}

	constructor(handle: string, label: string, avatar?: string, meta?: string, key?: NodeKey) {
		super(key);
		this.__handle = handle;
		this.__label = label;
		this.__avatar = avatar;
		this.__meta = meta;
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

	isKeyboardSelectable(): false {
		return false;
	}

	getTextContent(): string {
		return `@${this.__handle}`;
	}

	getHandle(): string {
		return this.__handle;
	}

	static importJSON(serialized: SerializedMemberTokenNode): MemberTokenNode {
		return new MemberTokenNode(serialized.handle, serialized.label, serialized.avatar, serialized.meta);
	}

	exportJSON(): SerializedMemberTokenNode {
		return {
			...super.exportJSON(),
			handle: this.__handle,
			label: this.__label,
			...(this.__avatar ? { avatar: this.__avatar } : {}),
			...(this.__meta ? { meta: this.__meta } : {}),
		};
	}

	decorate(): JSX.Element {
		return (
			<TokenChip
				iconNode={
					this.__avatar ? (
						<img src={this.__avatar} alt="" draggable={false} className="h-3 w-3 rounded-full object-cover" />
					) : undefined
				}
				label={`@${this.__label || this.__handle}`}
				title={this.__meta ? `${this.__label || this.__handle} · ${this.__meta}` : this.__handle}
				tone="member"
			/>
		);
	}
}

export function $createMemberTokenNode(handle: string, label: string, avatar?: string, meta?: string): MemberTokenNode {
	return new MemberTokenNode(handle, label, avatar, meta);
}

export function $isMemberTokenNode(node: LexicalNode | null | undefined): node is MemberTokenNode {
	return node instanceof MemberTokenNode;
}
