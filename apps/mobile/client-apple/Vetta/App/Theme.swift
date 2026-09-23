import SwiftUI
import UIKit

/// Vetta palette carried over from the Expo design. Every token resolves per
/// trait collection, so the app follows the system light/dark setting with no
/// in-app switch: dark emphasises white, light emphasises black.
enum Theme {
	static let page = dynamic(light: 0xF4F5F7, dark: 0x0A0B0D)
	static let card = dynamic(light: 0xFFFFFF, dark: 0x15171A)
	static let card2 = dynamic(light: 0xF0F1F3, dark: 0x1C1F23)
	static let line = dynamic(light: 0xE3E5E8, dark: 0x24272C)
	static let ink = dynamic(light: 0x0B0C0E, dark: 0xF4F5F6)
	static let ink2 = dynamic(light: 0x3F444B, dark: 0xB3B8BE)
	static let dim = dynamic(light: 0x6B7077, dark: 0x8B9096)
	static let faint = dynamic(light: 0x9AA0A6, dark: 0x5B6067)
	/// Inverted surface for the user's own bubble and primary pills.
	static let pill = dynamic(light: 0x0B0C0E, dark: 0xF4F5F6)
	static let pillInk = dynamic(light: 0xFFFFFF, dark: 0x0A0B0D)
	/// Switches are on in black, or mid grey in dark mode where a white track would hide the knob.
	static let switchOn = dynamic(light: 0x0B0C0E, dark: 0x6B7077)
	static let green = dynamic(light: 0x16A34A, dark: 0x22C55E)
	static let greenSoft = Color(red: 34 / 255, green: 197 / 255, blue: 94 / 255).opacity(0.14)
	static let orange = dynamic(light: 0xD97706, dark: 0xF59E0B)
	static let orangeSoft = Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255).opacity(0.14)
	static let red = dynamic(light: 0xDC2626, dark: 0xF0524F)
	/// A session that is working.
	static let blue = dynamic(light: 0x2563EB, dark: 0x3B82F6)
	/// The pin on a pinned session.
	static let yellow = dynamic(light: 0xE0A100, dark: 0xFACC15)
	/// The bot avatar's face in the desktop's black-and-white theme; its eyes are cut out.
	static let botFace = dynamic(light: 0x000000, dark: 0xE4E4E4)
	/// The glow New Session fades into at the bottom of the screen.
	static let dawn = dynamic(light: 0xD6E2FB, dark: 0x13235E)
	static let dawnSide = dynamic(light: 0xE6DEFA, dark: 0x1C1A52)

	/// UIKit resolves the colour on SwiftUI's render thread on device, so the
	/// provider must not inherit the module's main-actor isolation: a main-actor
	/// closure traps there (EXC_BREAKPOINT on com.apple.SwiftUI.AsyncRenderer).
	private nonisolated static func dynamic(light: UInt32, dark: UInt32) -> Color {
		Color(uiColor: UIColor { @Sendable traits in
			UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
		})
	}
}

extension UIColor {
	nonisolated convenience init(rgb: UInt32) {
		self.init(
			red: CGFloat((rgb >> 16) & 0xFF) / 255,
			green: CGFloat((rgb >> 8) & 0xFF) / 255,
			blue: CGFloat(rgb & 0xFF) / 255,
			alpha: 1
		)
	}
}

extension Font {
	static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
		.system(size: size, weight: weight, design: .monospaced)
	}
}
