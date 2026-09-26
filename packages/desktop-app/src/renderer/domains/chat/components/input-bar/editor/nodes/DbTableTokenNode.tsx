import { formatDbTableMention } from "@shared/lib/db-mentions/parse";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { DecoratorNode, $getNodeByKey, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { TokenChip } from "./TokenChip";

export type SerializedDbTableTokenNode = Spread<
	{ connection: string; scope?: string; table: string },
	SerializedLexicalNode
>;

/**
 * DbTableTokenNode 的 React 视图组件——拿到 Lexical editor context，
 * 把 dismiss（✕ 按钮）包进 editor.update() 里执行，确保 .remove()
 * 在有效的编辑器更新上下文中生效（Lexical 节点操作不能在 update 外部调用）。
 */
function DbTableTokenView({
	nodeKey,
	label,
	title,
}: {
	nodeKey: NodeKey;
	label: string;
	title: string;
}): JSX.Element {
	const [editor] = useLexicalComposerContext();
	return (
		<TokenChip
			icon="icon-[solar--document-text-linear]"
			label={label}
			title={title}
			dismiss={() => {
				editor.update(() => {
					$getNodeByKey(nodeKey)?.remove();
				});
			}}
		/>
	);
}

/**
 * 行内数据库表引用，序列化为 `@db:connection.table` 或 `@db:connection.scope.table`。
 * 和 FileTokenNode 同级的 Lexical DecoratorNode。
 */
export class DbTableTokenNode extends DecoratorNode<JSX.Element> {
	__connection: string;
	__scope?: string;
	__table: string;

	static getType(): string {
		return "db-table-token";
	}

	static clone(node: DbTableTokenNode): DbTableTokenNode {
		return new DbTableTokenNode(node.__connection, node.__table, node.__scope, node.__key);
	}

	constructor(connection: string, table: string, scope?: string, key?: NodeKey) {
		super(key);
		this.__connection = connection;
		this.__table = table;
		this.__scope = scope;
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
		return formatDbTableMention(this.__connection, this.__table, this.__scope);
	}

	getConnection(): string {
		return this.__connection;
	}

	getTable(): string {
		return this.__table;
	}

	getScope(): string | undefined {
		return this.__scope;
	}

	getDisplayLabel(): string {
		return this.__scope ? `${this.__scope}.${this.__table}` : this.__table;
	}

	getTooltip(): string {
		return formatDbTableMention(this.__connection, this.__table, this.__scope);
	}

	static importJSON(serialized: SerializedDbTableTokenNode): DbTableTokenNode {
		return $createDbTableTokenNode(serialized.connection, serialized.table, serialized.scope);
	}

	exportJSON(): SerializedDbTableTokenNode {
		return {
			...super.exportJSON(),
			connection: this.__connection,
			table: this.__table,
			scope: this.__scope,
		};
	}

	decorate(): JSX.Element {
		return (
			<DbTableTokenView
				nodeKey={this.__key}
				label={this.getDisplayLabel()}
				title={this.getTooltip()}
			/>
		);
	}
}

export function $createDbTableTokenNode(connection: string, table: string, scope?: string): DbTableTokenNode {
	return new DbTableTokenNode(connection, table, scope);
}

export function $isDbTableTokenNode(node: LexicalNode | null | undefined): node is DbTableTokenNode {
	return node instanceof DbTableTokenNode;
}
