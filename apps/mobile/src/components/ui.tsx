import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";

export function Screen({ children, className, ...props }: ViewProps & { children: ReactNode }) {
	return (
		<SafeAreaView edges={["top", "left", "right"]} className={`flex-1 bg-page ${className ?? ""}`} {...props}>
			{children}
		</SafeAreaView>
	);
}

interface HeaderProps {
	readonly title?: ReactNode;
	readonly subtitle?: string;
	readonly left?: { icon: LucideIcon; onPress: () => void; label: string };
	readonly right?: { icon: LucideIcon; onPress: () => void; label: string; tint?: string };
	readonly online?: boolean;
}

export function Header({ title, subtitle, left, right, online }: HeaderProps) {
	const { colors } = useTheme();
	return (
		<View className="h-14 flex-row items-center px-3">
			<View className="w-11 items-start">{left ? <IconButton icon={left.icon} onPress={left.onPress} label={left.label} /> : null}</View>
			<View className="flex-1 items-center">
				<View className="flex-row items-center gap-1.5">
					{typeof title === "string" ? <Text className="text-[17px] font-semibold text-ink">{title}</Text> : title}
					{online !== undefined ? <StatusDot color={online ? palette.green : colors.faint} /> : null}
				</View>
				{subtitle ? <Text className="mt-0.5 text-[12px] text-dim">{subtitle}</Text> : null}
			</View>
			<View className="w-11 items-end">
				{right ? <IconButton icon={right.icon} onPress={right.onPress} label={right.label} tint={right.tint} /> : null}
			</View>
		</View>
	);
}

export function IconButton({
	icon: Icon,
	onPress,
	label,
	tint,
	size = 20,
	disabled,
}: {
	icon: LucideIcon;
	onPress: () => void;
	label: string;
	tint?: string;
	size?: number;
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			disabled={disabled}
			hitSlop={8}
			className="h-10 w-10 items-center justify-center rounded-full active:bg-card-2"
		>
			<Icon size={size} color={tint ?? colors.ink} strokeWidth={1.8} />
		</Pressable>
	);
}

export function StatusDot({ color, size = 7, pulse }: { color: string; size?: number; pulse?: boolean }) {
	return (
		<View
			className="rounded-full"
			style={{ width: size, height: size, backgroundColor: color, opacity: pulse ? 0.9 : 1 }}
		/>
	);
}

export interface SegmentOption<T extends string> {
	readonly value: T;
	readonly label: string;
	readonly icon?: LucideIcon;
}

/** White active pill on a dark track, exactly as the design's filters and toggles. */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	stretch,
}: {
	options: readonly SegmentOption<T>[];
	value: T;
	onChange: (value: T) => void;
	stretch?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<View className={`flex-row items-center rounded-full ${stretch ? "bg-card p-1" : "gap-1"}`}>
			{options.map((option) => {
				const active = option.value === value;
				const Icon = option.icon;
				return (
					<Pressable
						key={option.value}
						accessibilityRole="button"
						accessibilityState={{ selected: active }}
						onPress={() => onChange(option.value)}
						className={`${stretch ? "flex-1" : ""} flex-row items-center justify-center gap-1.5 rounded-full px-4 ${stretch ? "py-2.5" : "py-2"} ${active ? "bg-pill" : ""}`}
					>
						{Icon ? <Icon size={15} color={active ? colors.pillInk : colors.ink2} strokeWidth={1.9} /> : null}
						<Text className={`text-[13px] ${active ? "font-semibold text-pill-ink" : "text-ink-2"}`}>{option.label}</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

export function Card({ children, className, ...props }: ViewProps & { children: ReactNode }) {
	return (
		<View className={`rounded-[22px] bg-card ${className ?? ""}`} {...props}>
			{children}
		</View>
	);
}

export function Divider({ className }: { className?: string }) {
	return <View className={`h-px bg-line ${className ?? ""}`} />;
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "orange" }) {
	const bg = tone === "green" ? "bg-vetta-green-soft" : tone === "orange" ? "bg-[rgba(245,158,11,0.14)]" : "bg-card-2";
	const fg = tone === "green" ? "text-vetta-green" : tone === "orange" ? "text-vetta-orange" : "text-dim";
	return (
		<View className={`rounded-full px-2.5 py-1 ${bg}`}>
			<Text className={`text-[11px] font-mono ${fg}`}>{children}</Text>
		</View>
	);
}

export function Banner({ text }: { text: string }) {
	return (
		<View className="mx-5 mb-2 rounded-2xl bg-card-2 px-4 py-2.5">
			<Text className="text-[12px] text-dim">{text}</Text>
		</View>
	);
}
