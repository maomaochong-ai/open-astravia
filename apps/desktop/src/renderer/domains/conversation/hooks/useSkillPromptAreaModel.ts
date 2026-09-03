import type { SkillInfo } from "@preload/api";
import type { SelectedSkill } from "@shared/store/atoms";
import type { SkillPromptAreaViewProps } from "@vetta/theme-ui/chat";
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
	skill: SelectedSkill | null | undefined;
	onSkillChange: (skill: SelectedSkill | null) => void;
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
	skill: SelectedSkill | null | undefined;
	handleSlashClose: () => void;
	handleSlashSelect: (picked: SkillInfo) => void;
}

export function useSkillPromptAreaModel({
	prompt,
	onPromptChange,
	skill,
	onSkillChange,
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
		void window.vetta.skills.list(cwd).then(setInstalledSkills);
	}, [cwd]);

	const skillMissing = useMemo(() => {
		if (!skill || installedSkills === null) return false;
		return !installedSkills.some((s) => s.name === skill.name && s.type === skill.type);
	}, [skill, installedSkills]);

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
		if (e.key === "Backspace" && prompt === "" && skill) {
			e.preventDefault();
			onSkillChange(null);
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
			onSkillChange({ name: picked.name, alias: picked.alias, type: picked.type });
			setSlashOpen(false);
			if (prompt.startsWith("/")) {
				onPromptChange("");
			}
			textareaRef.current?.focus();
		},
		[onSkillChange, onPromptChange, prompt],
	);

	const handlePlusClick = (): void => {
		setSlashOpen((prev) => !prev);
	};

	const handleRemoveSkill = (): void => {
		onSkillChange(null);
		textareaRef.current?.focus();
	};

	const isScene = skill?.type === "scene";

	return {
		prompt,
		placeholder: placeholder ?? t("skillPromptArea.placeholder"),
		minHeight,
		className,
		autoFocus,
		slashOpen,
		slashFilter,
		cwd,
		skill,
		skillMissing,
		isScene,
		skillDisplayName: skill ? skill.alias || skill.name : "",
		hasSkill: Boolean(skill),
		anchorRect,
		textareaRef: textareaRef as RefObject<HTMLTextAreaElement | null>,
		cardRef: cardRef as RefObject<HTMLDivElement | null>,
		labels: {
			removeSkill: t("skillPromptArea.removeSkill"),
			removeSkillMissing: t("skillPromptArea.removeSkillMissing"),
			missingBadge: t("skillPromptArea.missingBadge"),
			skillButtonTitle: t("skillPromptArea.skillButtonTitle"),
			skillButtonLabel: t("skillPromptArea.skillButtonLabel"),
		},
		onChange: handleChange,
		onKeyDown: handleKeyDown,
		onPlusClick: handlePlusClick,
		onRemoveSkill: handleRemoveSkill,
		handleSlashClose,
		handleSlashSelect,
	};
}
