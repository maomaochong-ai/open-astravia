import { useShortcutScope } from "@shared/shortcuts";
import { Slot } from "radix-ui";
import {
	createContext,
	forwardRef,
	type ButtonHTMLAttributes,
	type ComponentPropsWithoutRef,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export type { MessageFeedNavigationLabels, MessageFeedNavigationTurn } from "./navigationModel";

interface MessageFeedNavigationContextValue {
	readonly open: boolean;
	readonly query: string;
	readonly close: () => void;
	readonly setOpen: (open: boolean) => void;
	readonly setQuery: (query: string) => void;
	readonly toggle: () => void;
}

const MessageFeedNavigationContext = createContext<MessageFeedNavigationContextValue | null>(null);

export interface MessageFeedNavigationRootProps {
	readonly children: ReactNode;
	readonly defaultOpen?: boolean;
	readonly open?: boolean;
	readonly onOpenChange?: (open: boolean) => void;
}

export function MessageFeedNavigationRoot({
	children,
	defaultOpen = false,
	open: controlledOpen,
	onOpenChange,
}: MessageFeedNavigationRootProps): JSX.Element {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const [query, setQuery] = useState("");
	const open = controlledOpen ?? uncontrolledOpen;
	const setOpen = useCallback(
		(nextOpen: boolean) => {
			if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
			if (!nextOpen) setQuery("");
			onOpenChange?.(nextOpen);
		},
		[controlledOpen, onOpenChange],
	);
	const close = useCallback(() => setOpen(false), [setOpen]);
	const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

	useShortcutScope({
		id: "overlay:message-outline",
		kind: "overlay",
		active: open,
		bindings: [{ key: "escape", run: close }],
	});

	const value = useMemo(
		() => ({ close, open, query, setOpen, setQuery, toggle }),
		[close, open, query, setOpen, toggle],
	);
	return (
		<MessageFeedNavigationContext.Provider value={value}>
			{children}
		</MessageFeedNavigationContext.Provider>
	);
}

export function useMessageFeedNavigationContext(
	part = "MessageFeedNavigation",
): MessageFeedNavigationContextValue {
	const context = useContext(MessageFeedNavigationContext);
	if (!context) throw new Error(`${part} must be used within MessageFeedNavigation.Root`);
	return context;
}

function composeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
	return (node) => {
		for (const ref of refs) {
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		}
	};
}

export interface MessageFeedNavigationPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export const MessageFeedNavigationDismissable = forwardRef<
	HTMLDivElement,
	MessageFeedNavigationPrimitiveProps
>(function MessageFeedNavigationDismissable({ asChild = false, ...props }, forwardedRef) {
	const { close, open } = useMessageFeedNavigationContext("MessageFeedNavigation.Dismissable");
	const localRef = useRef<HTMLDivElement>(null);
	const Comp = asChild ? Slot.Root : "div";

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof Node) || localRef.current?.contains(target)) return;
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [close, open]);

	return <Comp ref={composeRefs(localRef, forwardedRef)} {...props} />;
});

export const MessageFeedNavigationState = forwardRef<
	HTMLDivElement,
	MessageFeedNavigationPrimitiveProps
>(function MessageFeedNavigationState({ asChild = false, ...props }, forwardedRef) {
	const { open } = useMessageFeedNavigationContext("MessageFeedNavigation.State");
	const Comp = asChild ? Slot.Root : "div";
	return (
		<Comp
			ref={forwardedRef}
			aria-expanded={open}
			data-state={open ? "open" : "closed"}
			{...props}
		/>
	);
});

export interface MessageFeedNavigationTriggerProps
	extends ButtonHTMLAttributes<HTMLButtonElement> {
	readonly asChild?: boolean;
}

export const MessageFeedNavigationTrigger = forwardRef<
	HTMLButtonElement,
	MessageFeedNavigationTriggerProps
>(function MessageFeedNavigationTrigger({ asChild = false, onClick, type, ...props }, forwardedRef) {
	const { open, toggle } = useMessageFeedNavigationContext("MessageFeedNavigation.Trigger");
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			ref={forwardedRef}
			type={asChild ? undefined : (type ?? "button")}
			aria-expanded={open}
			data-state={open ? "open" : "closed"}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) toggle();
			}}
			{...props}
		/>
	);
});

export const MessageFeedNavigationClose = forwardRef<
	HTMLButtonElement,
	MessageFeedNavigationTriggerProps
>(function MessageFeedNavigationClose({ asChild = false, onClick, type, ...props }, forwardedRef) {
	const { close } = useMessageFeedNavigationContext("MessageFeedNavigation.Close");
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			ref={forwardedRef}
			type={asChild ? undefined : (type ?? "button")}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) close();
			}}
			{...props}
		/>
	);
});

export interface MessageFeedNavigationSearchProps extends ComponentPropsWithoutRef<"input"> {
	readonly asChild?: boolean;
}

export const MessageFeedNavigationSearch = forwardRef<
	HTMLInputElement,
	MessageFeedNavigationSearchProps
>(function MessageFeedNavigationSearch({ asChild = false, onInput, ...props }, forwardedRef) {
	const { query, setQuery } = useMessageFeedNavigationContext("MessageFeedNavigation.Search");
	const Comp = asChild ? Slot.Root : "input";
	return (
		<Comp
			ref={forwardedRef}
			value={query}
			onInput={(event) => {
				onInput?.(event);
				if (!event.defaultPrevented) setQuery(event.currentTarget.value);
			}}
			{...props}
		/>
	);
});

export function MessageFeedNavigationContent({
	children,
}: {
	readonly children: ReactNode;
}): JSX.Element | null {
	const { open } = useMessageFeedNavigationContext("MessageFeedNavigation.Content");
	return open ? <>{children}</> : null;
}

export function MessageFeedNavigationPreview({
	children,
}: {
	readonly children: ReactNode;
}): JSX.Element | null {
	const { open } = useMessageFeedNavigationContext("MessageFeedNavigation.Preview");
	return open ? null : <>{children}</>;
}

export const MessageFeedNavigation = {
	Root: MessageFeedNavigationRoot,
	Dismissable: MessageFeedNavigationDismissable,
	State: MessageFeedNavigationState,
	Trigger: MessageFeedNavigationTrigger,
	Close: MessageFeedNavigationClose,
	Search: MessageFeedNavigationSearch,
	Content: MessageFeedNavigationContent,
	Preview: MessageFeedNavigationPreview,
} as const;
