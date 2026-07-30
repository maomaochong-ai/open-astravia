import { connectorTokenText } from "@shared/lib/input-tokens";
import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { TokenChip } from "./TokenChip";

export type SerializedConnectorTokenNode = Spread<
	{ name: string; label: string; iconUrl?: string },
	SerializedLexicalNode
>;

/**
 * 行内连接器（内置 MCP）引用，序列化为 `@mcp:名字`。
 *
 * 与 skill 一样是软引用：宿主不做任何工具门控，只是把「用哪个连接器」写进文本，
 * 由模型自行决定是否调用该 MCP 的工具。
 */
export class ConnectorTokenNode extends DecoratorNode<JSX.Element> {
	__name: string;
	/** 展示名（本地化后的 displayName）；序列化仍用 mcp.json 里的真实 name。 */
	__label: string;
	__iconUrl?: string;

	static getType(): string {
		return "connector-token";
	}

	static clone(node: ConnectorTokenNode): ConnectorTokenNode {
		return new ConnectorTokenNode(node.__name, node.__label, node.__iconUrl, node.__key);
	}

	constructor(name: string, label: string, iconUrl?: string, key?: NodeKey) {
		super(key);
		this.__name = name;
		this.__label = label;
		this.__iconUrl = iconUrl;
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
		return connectorTokenText(this.__name);
	}

	getName(): string {
		return this.__name;
	}

	static importJSON(serialized: SerializedConnectorTokenNode): ConnectorTokenNode {
		return $createConnectorTokenNode(serialized.name, serialized.label, serialized.iconUrl);
	}

	exportJSON(): SerializedConnectorTokenNode {
		return {
			...super.exportJSON(),
			name: this.__name,
			label: this.__label,
			...(this.__iconUrl ? { iconUrl: this.__iconUrl } : {}),
		};
	}

	decorate(): JSX.Element {
		return (
			<TokenChip
				icon="icon-[solar--plug-circle-linear]"
				iconUrl={this.__iconUrl}
				label={this.__label}
				title={this.__name}
			/>
		);
	}
}

export function $createConnectorTokenNode(name: string, label: string, iconUrl?: string): ConnectorTokenNode {
	return new ConnectorTokenNode(name, label, iconUrl);
}

export function $isConnectorTokenNode(node: LexicalNode | null | undefined): node is ConnectorTokenNode {
	return node instanceof ConnectorTokenNode;
}
