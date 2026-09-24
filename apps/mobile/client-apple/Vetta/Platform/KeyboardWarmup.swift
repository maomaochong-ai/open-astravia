import UIKit

/// iOS loads the keyboard the first time any field takes focus, so after a cold
/// start the first tap on the composer stalls for a second or so before the
/// keyboard rises. Focusing and releasing an invisible field once at launch
/// pays that cost up front; doing both in the same run loop turn keeps the
/// keyboard from ever showing.
enum KeyboardWarmup {
	private static var done = false

	static func run() {
		guard !done else { return }
		let window = UIApplication.shared.connectedScenes
			.compactMap { ($0 as? UIWindowScene)?.keyWindow }
			.first
		guard let window else { return }
		done = true
		let field = UITextField(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
		field.alpha = 0
		window.addSubview(field)
		field.becomeFirstResponder()
		field.resignFirstResponder()
		field.removeFromSuperview()
	}
}
