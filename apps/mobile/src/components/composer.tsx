import { ArrowUp, Sparkles, Square } from "lucide-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";

interface ComposerProps {
	readonly placeholder: string;
	readonly onSend: (text: string) => void | Promise<void>;
	readonly busy?: boolean;
	readonly onStop?: () => void;
	readonly disabled?: boolean;
	readonly leadingIcon?: boolean;
}

/** Frosted bottom bar with a round send button, shared by the home and chat screens. */
export function Composer({ placeholder, onSend, busy, onStop, disabled, leadingIcon }: ComposerProps) {
	const [text, setText] = useState("");
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const canSend = text.trim().length > 0 && !disabled;

	const submit = () => {
		if (!canSend) return;
		const value = text;
		setText("");
		void onSend(value);
	};

	return (
		<View className="px-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
			<View className="flex-row items-center rounded-full border border-line bg-card pl-4 pr-1.5 py-1.5">
				{leadingIcon ? <Sparkles size={18} color={palette.green} strokeWidth={1.8} /> : null}
				<TextInput
					className={`flex-1 ${leadingIcon ? "ml-2.5" : ""} py-2 text-[15px] text-ink`}
					placeholder={placeholder}
					placeholderTextColor={colors.dim}
					value={text}
					onChangeText={setText}
					onSubmitEditing={submit}
					returnKeyType="send"
					multiline={false}
					editable={!disabled}
					accessibilityLabel={placeholder}
				/>
				{busy && onStop ? (
					<Pressable accessibilityRole="button" accessibilityLabel="stop" onPress={onStop} className="h-10 w-10 items-center justify-center rounded-full bg-pill">
						<Square size={14} color={colors.pillInk} fill={colors.pillInk} />
					</Pressable>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="send"
						onPress={submit}
						disabled={!canSend}
						className={`h-10 w-10 items-center justify-center rounded-full ${canSend ? "bg-pill" : "bg-card-2"}`}
					>
						<ArrowUp size={18} color={canSend ? colors.pillInk : colors.faint} strokeWidth={2.2} />
					</Pressable>
				)}
			</View>
		</View>
	);
}
