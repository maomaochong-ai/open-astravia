import type { SkillPromptAreaViewProps } from "@astravia-org/theme-ui/chat";
import type { SkillInfo } from "@preload/api";
import type { SelectedSkill } from "@shared/store/atoms";
import {
	type ChangeEvent,
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface SkillPromptAreaModelInput {
	prompt: string;
	onPromptChange: (value: string) => void;
	/** 已选技能，按选择顺序。空数组等价于「未选」。 */
	skills: readonly SelectedSkill[];
	onSkillsChange: (skills: SelectedSkill[]) => void;
	/** 最多可选几个技能；不传表示不限。单技能的调用方传 1 即可保持旧行为。 */
	maxSkills?: number;
	placeholder?: string;
	minHeight?: number;
	className?: string;
	autoFocus?: boolean;
	cwd?: string;
}

export interface SkillPromptAreaModel extends Omit<SkillPromptAreaViewProps, "slashPanel"> {
	slashOpen: boolean;
	slashFilter: string;
	cwd?: string;
	skills: readonly SelectedSkill[];
	handleSlashClose: () => void;
	handleSlashSelect: (picked: SkillInfo) => void;
}

export function useSkillPromptAreaModel({
	prompt,
	onPromptChange,
	skills,
	onSkillsChange,
	maxSkills,
	placeholder,
	minHeight = 120,
	className,
	autoFocus,
	cwd,
}: SkillPromptAreaModelInput): SkillPromptAreaModel {
	const { t } = useTranslation("chat");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const [slashOpen, setSlashOpen] = useState(false);
	const [slashFilter, setSlashFilter] = useState("");
	const slashDismissedRef = useRef(false);
	const [installedSkills, setInstalledSkills] = useState<SkillInfo[] | null>(null);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

	useEffect(() => {
		if (!slashOpen) return;
		const updateRect = (): void => {
			const el = cardRef.current;
			if (el) setAnchorRect(el.getBoundingClientRect());
		};
		updateRect();
		window.addEventListener("resize", updateRect);
		window.addEventListener("scroll", updateRect, true);
		return () => {
			window.removeEventListener("resize", updateRect);
			window.removeEventListener("scroll", updateRect, true);
		};
	}, [slashOpen]);

	useEffect(() => {
		void window.astravia.skills.list(cwd).then(setInstalledSkills);
	}, [cwd]);

	const canAddSkill = maxSkills === undefined || skills.length < maxSkills;

	const selectedSkills = useMemo(
		() =>
			skills.map((skill) => ({
				id: skill.name,
				displayName: skill.alias || skill.name,
				missing:
					installedSkills !== null &&
					!installedSkills.some((installed) => installed.name === skill.name && installed.type === skill.type),
			})),
		[skills, installedSkills],
	);

	const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
		const val = e.target.value;
		onPromptChange(val);

		const cursorPos = e.target.selectionStart ?? val.length;
		const textBeforeCursor = val.slice(0, cursorPos);
		const slashActive =
			textBeforeCursor === "/" || (textBeforeCursor.startsWith("/") && !textBeforeCursor.includes(" "));
		if (!slashActive) {
			setSlashFilter("");
			slashDismissedRef.current = false;
			if (slashOpen) setSlashOpen(false);
		} else if (!slashDismissedRef.current) {
			setSlashFilter(textBeforeCursor);
			if (!slashOpen) setSlashOpen(true);
		}
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (
			slashOpen &&
			(e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape" || e.key === "Tab")
		) {
			e.preventDefault();
			return;
		}
		// 提示词为空时退格先摘掉最后一个技能：胶囊在输入框上方，退格是最顺手的撤销手势。
		if (e.key === "Backspace" && prompt === "" && skills.length > 0) {
			e.preventDefault();
			onSkillsChange(skills.slice(0, -1));
		}
	};

	const handleSlashClose = useCallback(() => {
		setSlashOpen(false);
		setSlashFilter("");
		const el = textareaRef.current;
		const cursorPos = el?.selectionStart ?? prompt.length;
		const textBeforeCursor = prompt.slice(0, cursorPos);
		if (textBeforeCursor === "/" || (textBeforeCursor.startsWith("/") && !textBeforeCursor.includes(" "))) {
			slashDismissedRef.current = true;
		}
	}, [prompt]);

	const handleSlashSelect = useCallback(
		(picked: SkillInfo) => {
			setSlashOpen(false);
			if (prompt.startsWith("/")) {
				onPromptChange("");
			}
			// 重复选中同一技能不加第二个胶囊，否则同一段技能正文会被注入两次。
			if (skills.some((skill) => skill.name === picked.name)) {
				textareaRef.current?.focus();
				return;
			}
			if (!canAddSkill) {
				textareaRef.current?.focus();
				return;
			}
			onSkillsChange([...skills, { name: picked.name, alias: picked.alias, type: picked.type }]);
			textareaRef.current?.focus();
		},
		[canAddSkill, onPromptChange, onSkillsChange, prompt, skills],
	);

	const handlePlusClick = (): void => {
		if (!canAddSkill) return;
		setSlashOpen((prev) => !prev);
	};

	const handleRemoveSkill = useCallback(
		(id: string) => {
			onSkillsChange(skills.filter((skill) => skill.name !== id));
			textareaRef.current?.focus();
		},
		[onSkillsChange, skills],
	);

	return {
		prompt,
		placeholder: placeholder ?? t("skillPromptArea.placeholder"),
		minHeight,
		className,
		autoFocus,
		slashOpen,
		slashFilter,
		cwd,
		skills,
		selectedSkills,
		canAddSkill,
		anchorRect,
		textareaRef: textareaRef as RefObject<HTMLTextAreaElement | null>,
		cardRef: cardRef as RefObject<HTMLDivElement | null>,
		labels: {
			removeSkill: t("skillPromptArea.removeSkill"),
			removeSkillMissing: t("skillPromptArea.removeSkillMissing"),
			missingBadge: t("skillPromptArea.missingBadge"),
			skillButtonTitle: t("skillPromptArea.skillButtonTitle"),
			skillButtonLabel: t("skillPromptArea.skillButtonLabel"),
			skillButtonLimitTitle: t("skillPromptArea.skillButtonLimitTitle"),
		},
		onChange: handleChange,
		onKeyDown: handleKeyDown,
		onPlusClick: handlePlusClick,
		onRemoveSkill: handleRemoveSkill,
		handleSlashClose,
		handleSlashSelect,
	};
}
