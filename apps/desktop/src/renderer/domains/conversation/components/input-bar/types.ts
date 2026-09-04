import type { SkillInfo } from "@preload/api";
import type { AppshotAttachment } from "@shared/store/atoms";
import type { TodoItem } from "@shared/store/todo-atoms";
import type { InputBarContextMenuViewProps, SessionDropZoneViewProps } from "@vetta/theme-ui/chat";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";
import type { ContextRingModel } from "../../hooks/useContextRingModel";
import type { ModelSelectorScope } from "../../hooks/useModelSelectorModel";
import type { AtPanelItem, AtPanelSelection } from "../AtPanel";
import type { ExecutionModeSelectorViewProps } from "../execution-mode-selector/types";
import type { McpElicitationPanel } from "../McpElicitationPanel";
import type { QuestionPanel } from "../QuestionPanel";
import type { ActiveActionCapsule } from "./ActiveActionCapsules";
import type { TriggerMatch } from "./editor/tokens/trigger";

export interface ConnectedInputBarProps {
	onSend: (overrideText?: string, context?: SendInteractionContext) => Promise<void>;
	onAbort: () => Promise<void>;
	onSendQueued?: (runtimeId: string, id: string) => void;
	/**
	 * 当无 activeSession 但仍希望放行输入与发送时（例如 NewSessionPage），
	 * 把该项目的 cwd 传进来：InputBar 把它视为「有会话」、@ 文件面板用它作为根目录。
	 */
	cwdOverride?: string;
	/**
	 * 命令区展开 / 收起时回调。命令区向上生长，宿主可以据此腾出空间
	 * （新会话页把整条输入栏下移，避免下方留白过大）。
	 */
	onExpandedChange?: (expanded: boolean) => void;
	/**
	 * 发送前还有一步准备工作在跑（新会话页要先把待创建的项目落盘）。
	 * 输入内容保持可编辑，发送按钮就地展开成带文案的胶囊并拒绝重复点击。
	 */
	sendPending?: { readonly label: string };
}

export interface ControlledInputBarProps {
	readonly model: InputBarModel;
}

export type InputBarProps = ControlledInputBarProps;

export interface SendInteractionContext {
	interactionId: string;
}

export interface InputBarLabels {
	capsule: {
		removeDefault: string;
		removeImage: string;
		removeTooltip: (path: string) => string;
		/** 多个 input action 折叠成一枚胶囊时的文案，如「3 个插件」。 */
		activeGroup: (count: number) => string;
	};
	permission: {
		deny: string;
		allow: string;
		allowSession: string;
	};
	toolbar: {
		skills: string;
		addImage: string;
		attachFile: string;
		queue: string;
	};
}

export interface SandboxPermissionRequestModel {
	title: string;
	message: string;
	sensitive?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
	onAllowSession?: () => void;
}

export type InputBarDrawerItem =
	| {
			kind: "sandbox-permission";
			id: string;
			label: string;
			desc: string;
			pulsing: boolean;
			request: SandboxPermissionRequestModel;
	  }
	| {
			kind: "queue";
			id: string;
			label: string;
			desc: string;
			/** abort/error 后队列暂停时脉冲提醒（ADR-0060）。 */
			pulsing?: boolean;
			runtimeId: string;
			onSendNow: (id: string) => void;
	  };

/** 输入卡片下方的待办条；无待办时为 null。 */
export interface InputBarTodoModel {
	items: readonly TodoItem[];
	/** 打开活动面板的待办页。 */
	onOpenPanel: () => void;
}

export interface SpeechInputModel {
	visible: boolean;
	active: boolean;
	disabled: boolean;
	title: string;
	statusText: string | null;
	onToggle: () => void;
}

export interface InputBarCommandModel {
	readonly slashOpen: boolean;
	readonly slashVisible: boolean;
	readonly slashFilter: string;
	readonly atOpen: boolean;
	readonly atFilter: string;
	/** Extra @ candidates supplied by the connector (for example Team members). */
	readonly atItems?: readonly AtPanelItem[];
	readonly onTriggerChange: (trigger: TriggerMatch | null) => void;
	readonly onSlashClose: () => void;
	readonly onSlashSelect: (skill: SkillInfo, icon?: string) => void;
	readonly onConnectorSelect: (connector: ConnectorGridItem) => void;
	readonly onAtClose: () => void;
	readonly onAtSelect: (selection: AtPanelSelection) => void;
	readonly onOpen: () => void;
}

export type InputBarLeadingTool = {
	readonly kind: "execution-mode";
	readonly model: ExecutionModeSelectorViewProps;
};
export type InputBarTrailingTool = {
	readonly kind: "context-usage";
	readonly model: ContextRingModel;
	/** Optional composition slot for hosts that need to extend the context ring. */
	readonly render?: (model: ContextRingModel) => ReactNode;
};

export interface InputBarModel {
	dropZone: Omit<SessionDropZoneViewProps, "children" | "className">;
	isStreaming: boolean;
	/** 宿主传入的发送前准备态，原样透给发送按钮。 */
	sendPending?: { readonly label: string };
	pendingQuestion: ComponentProps<typeof QuestionPanel>["pending"] | undefined;
	pendingMcpElicitation: ComponentProps<typeof McpElicitationPanel>["request"] | undefined;
	/** 输入卡片上方的图片缩略图行；label 与文本流里的「图 N」胶囊同源。 */
	imageAttachments: ReadonlyArray<{ path: string; name: string; url: string; label: string }>;
	/** 已激活的 input action；全量开关在命令面板里，这里只留激活提示。 */
	activeActions: readonly ActiveActionCapsule[];
	appshotAttachment: AppshotAttachment | null;
	hasSession: boolean;
	canSend: boolean;
	isEmpty: boolean;
	/** 输入框无任何字符（含空格）时展示覆盖层 placeholder；与原生行为一致 */
	showPlaceholder: boolean;
	hasCapsules: boolean;
	effectiveCwd: string;
	/** 空输入时展示的占位文案；多条时垂直轮播 */
	placeholderTexts: readonly string[];
	/** 是否对 placeholderTexts 做自动上下切换（suggestion/thinking 等为 false） */
	placeholderRotating: boolean;
	isFocused: boolean;
	/** 普通会话可装配命令面板；不支持命令的 Connector 不创建空模型。 */
	commands?: InputBarCommandModel;
	drawerItems: InputBarDrawerItem[];
	drawerActiveTab: string | null;
	/** 输入卡片外部下方的待办条。 */
	todo: InputBarTodoModel | null;
	/** Windows 本地流式语音输入；其他平台不渲染入口。 */
	speechInput: SpeechInputModel | null;
	hasPromptAttachment: boolean;
	promptAttachmentIcon?: string;
	promptAttachmentLabel?: string;
	/** 逐条渲染的条目名；插件没给 `labels` 时就是 `[promptAttachmentLabel]`。 */
	promptAttachmentLabels?: string[];
	/** Latest user message replacement pending (applied on send). */
	pendingMessageEdit: boolean;
	pendingEditHint: string;
	cancelPendingEditLabel: string;
	/** 输入区右键剪切/复制/粘贴菜单；关闭时为 null。 */
	contextMenu: InputBarContextMenuViewProps | null;
	editor: {
		readonly namespace: string;
		readonly value?: string;
		readonly history?: readonly string[];
		readonly onValueChange?: (value: string) => void;
		readonly persistenceId?: string | null;
	};
	routing?: {
		/** Whether to render the inline aggregate status beside the member buttons. */
		readonly showStatusSummary?: boolean;
		readonly participants: readonly {
			readonly id: string;
			readonly name: string;
			readonly avatar?: string;
			readonly blueprintId: string;
			readonly badgeLabel?: string;
			/** Visible status text for Team member activity (for example, "Replying"). */
			readonly statusLabel?: string;
			readonly selected: boolean;
			readonly status: "idle" | "working" | "error";
			readonly onSelect: () => void;
		}[];
	};
	modelSelector: {
		readonly updateActiveSession: boolean;
		readonly scope?: ModelSelectorScope;
	};
	/** 工具栏按真实组成项装配，避免用 showX/capability 布尔值扩展产品分支。 */
	leadingTools: readonly InputBarLeadingTool[];
	trailingTools: readonly InputBarTrailingTool[];
	sendBehavior: "direct" | "queueable";
	labels: InputBarLabels;
	actions: {
		setFocused: (focused: boolean) => void;
		setDrawerActiveTab: (tabId: string | null) => void;
		/** 回车键；返回 true 表示已当作发送处理，编辑器不再插换行。 */
		handleEnter: () => boolean;
		handleContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
		/** 从文本流里删掉该图片的 token（缩略图行的 × 按钮）。 */
		removeImage: (path: string) => void;
		openImagePreview: (index: number) => void;
		removePromptAttachment: () => void;
		removeAppshot: () => void;
		handleSelectImages: () => Promise<void>;
		handleSelectFiles: () => Promise<void>;
		handleSend: () => void;
		handleAbort: () => Promise<void>;
		cancelPendingEdit: () => void;
	};
}

export interface InputBarViewClassNames {
	root?: string;
	stack?: string;
	card?: string;
	cardContent?: string;
	capsules?: string;
	editorWrap?: string;
	toolbar?: string;
}

export interface InputBarViewProps {
	model: InputBarModel;
	className?: string;
	classNames?: InputBarViewClassNames;
}
