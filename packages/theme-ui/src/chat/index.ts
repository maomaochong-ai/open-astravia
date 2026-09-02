import "../registry";
import type { ComponentType } from "react";
import type { InputBarBackground } from "./InputBarBackground";
import type { InputBarPlaceholder } from "./InputBarPlaceholder";
import type {
	NewSessionGuidingWordsProps,
	NewSessionHeroProps,
	NewSessionSceneCarouselProps,
	NewSessionSkillBadgeRowProps,
} from "./NewSession";
import type { SceneCard } from "./SceneCard";
import type { SkillCard } from "./SkillCard";
import type { TodoStatusBarView } from "./TodoStatusBarView";

declare module "@vetta/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "chat.inputBarBackground"?: typeof InputBarBackground;
		readonly "chat.inputBarPlaceholder"?: typeof InputBarPlaceholder;
		readonly "chat.newSessionGuidingWords"?: ComponentType<NewSessionGuidingWordsProps>;
		readonly "chat.newSessionHero"?: ComponentType<NewSessionHeroProps>;
		readonly "chat.newSessionSceneCard"?: typeof SceneCard;
		readonly "chat.newSessionSceneCarousel"?: ComponentType<NewSessionSceneCarouselProps>;
		readonly "chat.newSessionSkillBadgeRow"?: ComponentType<NewSessionSkillBadgeRowProps>;
		readonly "chat.newSessionSkillCard"?: typeof SkillCard;
		readonly "chat.todoStatusBar"?: typeof TodoStatusBarView;
	}
}

export type { ActionButtonBarItem, ActionButtonBarViewProps } from "./ActionButtonBarView";
export { ActionButtonBarView } from "./ActionButtonBarView";
export type { AgentAvatarViewProps } from "./AgentAvatarView";
export { AgentAvatarView } from "./AgentAvatarView";
export type { AppshotCardViewLabels, AppshotCardViewProps } from "./AppshotCardView";
export { AppshotCardView } from "./AppshotCardView";
export type {
	AskUserQuestionItem,
	AskUserQuestionOption,
	AskUserQuestionViewLabels,
	AskUserQuestionViewProps,
} from "./AskUserQuestionView";
export { AskUserQuestionView } from "./AskUserQuestionView";
export type { AssistantMessageFoldLabels } from "./AssistantMessageView";
export {
	AssistantMessage,
	AssistantMessageFold,
	AssistantMessagePredictingStatus,
	AssistantMessageStreamingStatus,
	StreamingIndicator,
} from "./AssistantMessageView";
export type {
	AtPanelClassNames,
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelViewProps,
} from "./AtPanelView";
export { AtPanelView } from "./AtPanelView";
export type { BackgroundTasksBadgeViewProps } from "./BackgroundTasksBadgeView";
export { BackgroundTasksBadgeView } from "./BackgroundTasksBadgeView";
export type {
	BashTerminalLabels,
	BashTerminalPrimitiveProps,
	BashTerminalRootProps,
	BashTerminalStatus,
} from "./BashTerminalCard";
export {
	BashTerminal,
	BashTerminalBackgroundTaskTail,
	BashTerminalCard,
	BashTerminalCommand,
	BashTerminalCopyAction,
	BashTerminalHeader,
	BashTerminalHeaderLabel,
	BashTerminalMeta,
	BashTerminalPendingStatus,
	BashTerminalResult,
	BashTerminalRoot,
	BashTerminalStatusDot,
} from "./BashTerminalCard";
export type { ChatExportHostViewProps } from "./ChatExportHostView";
export { ChatExportHostView } from "./ChatExportHostView";
export {
	ChatHeaderActions,
	ChatHeaderExportAction,
	ChatHeaderPanelAction,
	ChatHeaderPinAction,
} from "./ChatHeaderActionsView";
export type { ContextRingViewProps } from "./ContextRingView";
export { CIRCUMFERENCE as CONTEXT_RING_CIRCUMFERENCE, ContextRingView } from "./ContextRingView";
export type { CopyIconButtonLabels, CopyIconButtonProps } from "./CopyIconButton";
export { CopyIconButton } from "./CopyIconButton";
export {
	DefaultGuidingWords,
	NEW_SESSION_GUIDING_WORDS_SLOT_MIN_H_CLASS,
} from "./DefaultGuidingWords";
export {
	DefaultSceneCarousel,
	NEW_SESSION_SCENE_SLOT_MIN_H_CLASS,
} from "./DefaultSceneCarousel";
export {
	DefaultSkillBadgeRow,
	NEW_SESSION_SKILL_BADGE_SLOT_MIN_H_CLASS,
} from "./DefaultSkillBadgeRow";
export type { DrawerCardProps, DrawerTab } from "./DrawerCard";
export { DrawerCard } from "./DrawerCard";
export type {
	AnchorEditItemView,
	AnchorEditsFallbackViewProps,
	DiffLineKind,
	DiffLineView,
	DiffPreviewViewProps,
	EditTextFallbackViewProps,
} from "./EditDiffView";
export { AnchorEditsFallbackView, DiffPreviewView, EditTextFallbackView } from "./EditDiffView";
export type {
	ExecutionModeOptionView,
	ExecutionModeSelectorViewProps,
} from "./ExecutionModeSelectorView";
export { ExecutionModeSelectorView } from "./ExecutionModeSelectorView";
export type { ExportMessageListViewProps } from "./ExportMessageListView";
export { ExportMessageListView } from "./ExportMessageListView";
export type {
	GuideBadgeSwiperViewLabels,
	GuideBadgeSwiperViewProps,
	GuideBadgeViewItem,
} from "./GuideBadgeSwiperView";
export { GuideBadgeSwiperView } from "./GuideBadgeSwiperView";
export type {
	InputActionBarItemView,
	InputActionBarViewModel,
	InputActionBarViewProps,
} from "./InputActionBarView";
export { InputActionBarView } from "./InputActionBarView";
export type { InputBarBackgroundProps } from "./InputBarBackground";
export { InputBarBackground } from "./InputBarBackground";
export type { InputBarCapsuleLabels, InputBarCapsuleProps } from "./InputBarCapsule";
export { InputBarCapsule } from "./InputBarCapsule";
export type {
	InputBarContextMenuViewLabels,
	InputBarContextMenuViewProps,
} from "./InputBarContextMenuView";
export { InputBarContextMenuView } from "./InputBarContextMenuView";
export type {
	InputBarPlaceholderClassNames,
	InputBarPlaceholderProps,
} from "./InputBarPlaceholder";
export { InputBarPlaceholder } from "./InputBarPlaceholder";
export type { InputBarToolbarButtonProps } from "./InputBarToolbarButton";
export { InputBarToolbarButton } from "./InputBarToolbarButton";
export type {
	KbFilterByTagsViewProps,
	KbFilterPageItem,
	KbListTagsViewProps,
	KbTagItem,
	KbWritePageViewProps,
} from "./KnowledgeToolViews";
export { KbFilterByTagsView, KbListTagsView, KbWritePageView } from "./KnowledgeToolViews";
export type { LiveThinkingViewProps } from "./LiveThinkingView";
export { LiveThinkingView } from "./LiveThinkingView";
export type { CopyButtonLabels } from "./MessageActions";
export {
	CopyButton,
	formatDuration,
	formatRelativeTime,
	formatTime,
	RelativeTimeLabel,
} from "./MessageActions";
export type { SegmentShellProps, ToolCallGroupViewProps } from "./MessageBlockSegmentsView";
export { ErrorBlockView, SegmentShell, ToolCallGroupView } from "./MessageBlockSegmentsView";
export type {
	CompactionBoundaryViewProps,
	ForkOriginBannerViewProps,
	ModelSwitchBoundaryViewProps,
} from "./MessageBoundaryViews";
export {
	CompactionBoundaryView,
	ForkOriginBannerView,
	ModelSwitchBoundaryView,
} from "./MessageBoundaryViews";
export type {
	MessageCardsTabItem,
	MessageCardsViewLabels,
	MessageCardsViewProps,
} from "./MessageCardsView";
export { MessageCardsView } from "./MessageCardsView";
export type {
	MessageFeedLayoutPrimitiveProps,
	MessageFeedListLayoutProps,
} from "./MessageFeedLayoutView";
export {
	MessageFeedLayout,
	MessageFeedLayoutFrame,
	MessageFeedLayoutLeftRail,
	MessageFeedLayoutList,
	MessageFeedLayoutRailContent,
	MessageFeedLayoutState,
	MessageFeedLayoutViewport,
	MessageFeedLayoutVirtualizer,
} from "./MessageFeedLayoutView";
export type {
	MessageFeedPrimitiveProps,
	MessageFeedRootProps,
	MessageFeedVirtualListChild,
	MessageFeedVirtualListProps,
} from "./MessageFeedView";
export {
	MessageFeed,
	MessageFeedFooter,
	MessageFeedRoot,
	MessageFeedVirtualList,
} from "./MessageFeedView";
export type {
	MessageInputDropZoneProps,
	MessageInputPrimitiveProps,
	MessageInputRootProps,
} from "./MessageInputView";
export {
	MessageInput,
	MessageInputContent,
	MessageInputDropZone,
	MessageInputRoot,
	MessageInputSurface,
	MessageInputToolbar,
	MessageInputToolbarLeading,
	MessageInputToolbarTrailing,
} from "./MessageInputView";
export type {
	MessageLayoutKind,
	MessageLayoutPrimitiveProps,
} from "./MessageLayoutView";
export {
	MessageLayout,
	MessageLayoutAfterBody,
	MessageLayoutBeforeBody,
	MessageLayoutEvent,
	MessageLayoutFooter,
	MessageLayoutHeader,
	MessageLayoutHeaderLeading,
	MessageLayoutIncoming,
	MessageLayoutIncomingSurface,
	MessageLayoutOutgoing,
	MessageLayoutOutgoingContent,
} from "./MessageLayoutView";
export type { MessageListFooterPrimitiveProps } from "./MessageListFooterView";
export {
	MessageListFooter,
	MessageListFooterCompacting,
	MessageListFooterPending,
	MessageListFooterPresence,
	MessageListFooterRetry,
	MessageListFooterRoot,
	MessageListFooterWaiting,
} from "./MessageListFooterView";
export type {
	MessageSelectionContextMenuViewLabels,
	MessageSelectionContextMenuViewProps,
} from "./MessageSelectionContextMenuView";
export { MessageSelectionContextMenuView } from "./MessageSelectionContextMenuView";
export type {
	MessageTimelineButtonProps,
	MessageTimelinePrimitiveProps,
	MessageTimelineTickProps,
} from "./MessageTimelineView";
export {
	MessageTimeline,
	MessageTimelineBody,
	MessageTimelineClose,
	MessageTimelineCount,
	MessageTimelineEmpty,
	MessageTimelineEntry,
	MessageTimelineEntryMatch,
	MessageTimelineEntryPreview,
	MessageTimelineNavigation,
	MessageTimelinePanel,
	MessageTimelinePanelHeader,
	MessageTimelinePanelHeading,
	MessageTimelinePanelPositioner,
	MessageTimelineRail,
	MessageTimelineRoot,
	MessageTimelineTick,
	MessageTimelineTickPreview,
	MessageTimelineTitle,
	MessageTimelineTrigger,
} from "./MessageTimelineView";
export type { MessageRootProps, MessageTextProps } from "./MessageView";
export {
	Message,
	MessageAuthor,
	MessageMeta,
	MessageRoot,
	MessageStatus,
} from "./MessageView";
export {
	MessageVisual,
	MessageVisualEventBubble,
	MessageVisualOutgoingBubble,
} from "./MessageVisualView";
export type {
	ModelSelectorLabels,
	ModelSelectorOptionView,
	ModelSelectorProviderGroup,
	ModelSelectorViewProps,
} from "./ModelSelectorView";
export { ModelSelectorView } from "./ModelSelectorView";
export type {
	NewSessionGuidingWordsGroup,
	NewSessionGuidingWordsProps,
	NewSessionHeroProps,
	NewSessionSceneActionState,
	NewSessionSceneCarouselLabels,
	NewSessionSceneCarouselProps,
	NewSessionSceneItem,
	NewSessionSelection,
	NewSessionSkillBadgeRowLabels,
	NewSessionSkillBadgeRowProps,
	NewSessionSkillItem,
	NewSessionSkillSelection,
} from "./NewSession";
export { NewSessionBackground } from "./NewSessionBackground";
export type { NewSessionPageLayoutViewProps } from "./NewSessionPageLayoutView";
export { NewSessionPageLayoutView } from "./NewSessionPageLayoutView";
export type {
	ProgressGroupPrimitiveProps,
	ProgressGroupRootProps,
	ProgressGroupRowPrimitiveProps,
	ProgressGroupRowRootProps,
	ProgressGroupRowTriggerProps,
	ProgressGroupTriggerProps,
} from "./ProgressGroupView";
export {
	ProgressGroup,
	ProgressGroupChevron,
	ProgressGroupContent,
	ProgressGroupFrame,
	ProgressGroupRoot,
	ProgressGroupRowChevron,
	ProgressGroupRowContent,
	ProgressGroupRowFrame,
	ProgressGroupRowRoot,
	ProgressGroupRowStatus,
	ProgressGroupRowText,
	ProgressGroupRowTrigger,
	ProgressGroupStatus,
	ProgressGroupTitle,
	ProgressGroupTrigger,
} from "./ProgressGroupView";
export type {
	ProjectSelectorOptionView,
	ProjectSelectorViewLabels,
	ProjectSelectorViewProps,
} from "./ProjectSelectorView";
export { ProjectSelectorView } from "./ProjectSelectorView";
export type {
	QueueCardItem,
	QueueCardPausedBanner,
	QueueCardViewLabels,
	QueueCardViewProps,
} from "./QueueCardView";
export { QueueCardView } from "./QueueCardView";
export type { ReadImageViewProps } from "./ReadImageView";
export { ReadImageView } from "./ReadImageView";
export type {
	SandboxGrantsBadgeViewLabels,
	SandboxGrantsBadgeViewProps,
	SandboxGrantViewItem,
} from "./SandboxGrantsBadgeView";
export { SandboxGrantsBadgeView } from "./SandboxGrantsBadgeView";
export type {
	SandboxPermissionCardLabels,
	SandboxPermissionCardProps,
	SandboxPermissionRequestModel,
} from "./SandboxPermissionCard";
export { SandboxPermissionCard } from "./SandboxPermissionCard";
export type {
	SceneCardActionState,
	SceneCardClassNames,
	SceneCardModel,
	SceneCardProps,
	SceneCardState,
} from "./SceneCard";
export { SceneCard } from "./SceneCard";
export type { SendButtonLabels, SendButtonProps } from "./SendButton";
export { SendButton } from "./SendButton";
export type {
	SessionDropDragKind,
	SessionDropZoneViewLabels,
	SessionDropZoneViewProps,
} from "./SessionDropZoneView";
export { SessionDropZoneView } from "./SessionDropZoneView";
export type { SessionViewerPageViewProps } from "./SessionViewerPageView";
export { SessionViewerPageView } from "./SessionViewerPageView";
export type { SkillCardClassNames, SkillCardModel, SkillCardProps } from "./SkillCard";
export { SkillCard } from "./SkillCard";
export type {
	SkillPromptAreaViewLabels,
	SkillPromptAreaViewProps,
} from "./SkillPromptAreaView";
export { SkillPromptAreaView } from "./SkillPromptAreaView";
export type { SuggestionBubblesViewProps } from "./SuggestionBubblesView";
export { SuggestionBubblesView } from "./SuggestionBubblesView";
export type {
	InlineTokenPiece,
	InlineTokenSupport,
	TextBlockViewLabels,
	TextBlockViewProps,
} from "./TextBlockView";
export { TextBlockView } from "./TextBlockView";
export type { TextPreviewLabels, TextPreviewProps } from "./TextPreview";
export { TextPreview } from "./TextPreview";
export type {
	ThinkingBlockPrimitiveProps,
	ThinkingBlockRootProps,
	ThinkingBlockTriggerProps,
} from "./ThinkingBlockView";
export {
	ThinkingBlock,
	ThinkingBlockChevron,
	ThinkingBlockContent,
	ThinkingBlockFrame,
	ThinkingBlockIcon,
	ThinkingBlockLineCount,
	ThinkingBlockRoot,
	ThinkingBlockTitle,
	ThinkingBlockTrigger,
} from "./ThinkingBlockView";
export type { TodoCardItem, TodoCardLabels, TodoCardProps } from "./TodoCard";
export { TodoCard } from "./TodoCard";
export type {
	TodoStatusItem,
	TodoStatusSummary,
	TodoTimelineLabels,
	TodoTimelineProps,
} from "./TodoProgress";
export {
	selectTodoStatusSummary,
	TODO_PROGRESS_CSS,
	TodoProgressBar,
	TodoProgressStyles,
	TodoStatusDot,
	TodoTimeline,
	todoLabelSheenStyle,
} from "./TodoProgress";
export type { TodoStatusBarLabels, TodoStatusBarViewProps } from "./TodoStatusBarView";
export { TodoStatusBarView } from "./TodoStatusBarView";
export type {
	ToolCallPrimitiveProps,
	ToolCallRootProps,
	ToolCallTriggerProps,
} from "./ToolCallBlockView";
export {
	ToolCall,
	ToolCallBadge,
	ToolCallChevron,
	ToolCallContent,
	ToolCallDetail,
	ToolCallEmbedded,
	ToolCallFrame,
	ToolCallName,
	ToolCallPhase,
	ToolCallRoot,
	ToolCallServer,
	ToolCallStatusIcon,
	ToolCallTrigger,
} from "./ToolCallBlockView";
export type { UsageBarViewProps } from "./UsageBarView";
export { UsageBarView } from "./UsageBarView";
export type {
	UserMessageContextMenuViewLabels,
	UserMessageContextMenuViewProps,
} from "./UserMessageContextMenuView";
export { UserMessageContextMenuView } from "./UserMessageContextMenuView";
export type {
	UserMessageEntryState,
	UserMessageViewLabels,
} from "./UserMessageView";
export {
	SettingsAssistBadgeView,
	SkillBadgeView,
	UserMessage,
	UserMessageAction,
	UserMessageFrame,
	UserMessageText,
} from "./UserMessageView";
export type {
	UseHorizontalDragScrollOptions,
	UseHorizontalDragScrollResult,
} from "./useHorizontalDragScroll";
export { useHorizontalDragScroll } from "./useHorizontalDragScroll";
export type { WorkflowFooterItem, WorkflowFooterItemsViewProps } from "./WorkflowFooterItemsView";
export { WorkflowFooterItemsView } from "./WorkflowFooterItemsView";
export type { WriteContentViewProps } from "./WriteContentView";
export { WriteContentView } from "./WriteContentView";
