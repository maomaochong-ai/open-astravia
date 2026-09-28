import SwiftUI
import UIKit
import VettaKit
@preconcurrency import WebRTC

/// The desktop's screen with the whole phone screen as its trackpad (ADR-0140): one
/// finger moves the cursor from where it is, anywhere on the screen, picture or not; a
/// tap clicks and a two-finger tap right-clicks where the cursor is; holding a finger
/// half a second presses the button, so moving then drags. Two fingers pinch to zoom
/// the picture and move it once zoomed. The cursor is drawn by the phone, large and
/// always on top, and a zoomed picture follows it.
public struct RemoteScreenView: UIViewRepresentable {
	let track: RTCVideoTrack?
	let interactive: Bool
	/// Room left around the picture for the page's controls; touches there still count.
	let insets: UIEdgeInsets
	let onInput: ([RemoteInputCommand]) -> Void

	public init(track: RTCVideoTrack?, interactive: Bool, insets: UIEdgeInsets, onInput: @escaping ([RemoteInputCommand]) -> Void) {
		self.track = track
		self.interactive = interactive
		self.insets = insets
		self.onInput = onInput
	}

	public func makeUIView(context: Context) -> RemoteScreenSurface {
		RemoteScreenSurface()
	}

	public func updateUIView(_ view: RemoteScreenSurface, context: Context) {
		view.onInput = onInput
		view.interactive = interactive
		view.pictureInsets = insets
		view.attach(track)
	}

	public static func dismantleUIView(_ view: RemoteScreenSurface, coordinator: ()) {
		view.attach(nil)
	}
}

public final class RemoteScreenSurface: UIView, UIGestureRecognizerDelegate, RTCVideoViewDelegate {
	var onInput: ([RemoteInputCommand]) -> Void = { _ in }
	var interactive = true
	var pictureInsets: UIEdgeInsets = .zero {
		didSet { if pictureInsets != oldValue { setNeedsLayout() } }
	}

	private let video = RTCMTLVideoView()
	private let cursor = makeCursor()
	private var track: RTCVideoTrack?
	private var videoSize: CGSize = .zero
	private var viewport = RemoteViewport()
	private var trackpad = RemoteTrackpad()
	private var lastPan: CGPoint = .zero
	private var lastHold: CGPoint = .zero
	private var lastPinchScale: CGFloat = 1
	private var lastTwoFingerTranslation: CGPoint = .zero
	private let tapFeel = UIImpactFeedbackGenerator(style: .light)
	private let rightFeel = UIImpactFeedbackGenerator(style: .medium)
	private let dragFeel = UIImpactFeedbackGenerator(style: .rigid)

	init() {
		super.init(frame: .zero)
		backgroundColor = .black
		clipsToBounds = true
		video.videoContentMode = .scaleToFill
		video.delegate = self
		video.isUserInteractionEnabled = false
		addSubview(video)
		layer.addSublayer(cursor)
		cursor.isHidden = true

		let move = UIPanGestureRecognizer(target: self, action: #selector(moved))
		move.maximumNumberOfTouches = 1
		let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
		let rightTap = UITapGestureRecognizer(target: self, action: #selector(rightTapped))
		rightTap.numberOfTouchesRequired = 2
		let hold = UILongPressGestureRecognizer(target: self, action: #selector(held))
		hold.minimumPressDuration = 0.5
		hold.allowableMovement = 10
		let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinched))
		let twoFingers = UIPanGestureRecognizer(target: self, action: #selector(twoFingersMoved))
		twoFingers.minimumNumberOfTouches = 2
		twoFingers.maximumNumberOfTouches = 2
		for recognizer in [move, tap, rightTap, hold, pinch, twoFingers] as [UIGestureRecognizer] {
			recognizer.delegate = self
			addGestureRecognizer(recognizer)
		}
		// Two fingers landing a moment apart are a right-click, not a click first.
		tap.require(toFail: rightTap)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

	func attach(_ next: RTCVideoTrack?) {
		guard next !== track else { return }
		track?.remove(video)
		track = next
		next?.add(video)
	}

	// MARK: Layout

	/// Where the unzoomed picture sits: the video's shape fitted inside the insets.
	private var pictureRect: CGRect {
		let area = bounds.inset(by: pictureInsets)
		let fitted = RemoteViewport.fitted(
			videoWidth: videoSize.width, videoHeight: videoSize.height,
			containerWidth: area.width, containerHeight: area.height
		)
		return CGRect(x: area.minX + fitted.x, y: area.minY + fitted.y, width: fitted.width, height: fitted.height)
	}

	public override func layoutSubviews() {
		super.layoutSubviews()
		applyViewport()
	}

	/// The video view takes the zoomed size itself rather than being scaled by a
	/// transform, so the picture is drawn at full sharpness however far it is zoomed.
	private func applyViewport() {
		let rect = pictureRect
		video.frame = CGRect(
			x: rect.midX - rect.width * viewport.zoom / 2 + viewport.panX,
			y: rect.midY - rect.height * viewport.zoom / 2 + viewport.panY,
			width: rect.width * viewport.zoom,
			height: rect.height * viewport.zoom
		)
		placeCursor()
	}

	private func placeCursor() {
		guard videoSize != .zero else {
			cursor.isHidden = true
			return
		}
		let rect = pictureRect
		let shown = viewport.toView(x: trackpad.cursor.x, y: trackpad.cursor.y, width: rect.width, height: rect.height)
		CATransaction.begin()
		CATransaction.setDisableActions(true)
		cursor.position = CGPoint(x: rect.minX + shown.x, y: rect.minY + shown.y)
		cursor.isHidden = false
		CATransaction.commit()
	}

	public nonisolated func videoView(_ videoView: any RTCVideoRenderer, didChangeVideoSize size: CGSize) {
		DispatchQueue.main.async {
			MainActor.assumeIsolated {
				guard size.width > 0, size.height > 0, size != self.videoSize else { return }
				self.videoSize = size
				self.viewport = RemoteViewport()
				self.setNeedsLayout()
			}
		}
	}

	// MARK: Gestures

	public override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
		guard videoSize != .zero else { return false }
		// Zooming and moving the picture stay available when taps cannot reach the desktop.
		if recognizer is UIPinchGestureRecognizer { return true }
		if let pan = recognizer as? UIPanGestureRecognizer, pan.minimumNumberOfTouches == 2 { return true }
		return interactive
	}

	public func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
		// Pinch and two-finger move read the same fingers.
		let pair: [UIGestureRecognizer] = [recognizer, other]
		return pair.contains { $0 is UIPinchGestureRecognizer } && pair.contains { ($0 as? UIPanGestureRecognizer)?.minimumNumberOfTouches == 2 }
	}

	@objc private func moved(_ recognizer: UIPanGestureRecognizer) {
		let translation = recognizer.translation(in: self)
		switch recognizer.state {
		case .began:
			lastPan = translation
		case .changed:
			let velocity = recognizer.velocity(in: self)
			moveCursor(dx: translation.x - lastPan.x, dy: translation.y - lastPan.y, speed: hypot(velocity.x, velocity.y))
			lastPan = translation
		default:
			break
		}
	}

	@objc private func tapped(_ recognizer: UITapGestureRecognizer) {
		guard recognizer.state == .ended else { return }
		onInput(trackpad.click(.left))
		tapFeel.impactOccurred()
	}

	@objc private func rightTapped(_ recognizer: UITapGestureRecognizer) {
		guard recognizer.state == .ended else { return }
		onInput(trackpad.click(.right))
		rightFeel.impactOccurred()
	}

	/// Held half a second: the button goes down, the finger then drags, lifting lets go.
	@objc private func held(_ recognizer: UILongPressGestureRecognizer) {
		let point = recognizer.location(in: self)
		switch recognizer.state {
		case .began:
			lastHold = point
			dragFeel.impactOccurred()
			onInput([trackpad.press(.down)])
		case .changed:
			moveCursor(dx: point.x - lastHold.x, dy: point.y - lastHold.y, speed: 0)
			lastHold = point
		default:
			onInput([trackpad.press(.up)])
		}
	}

	@objc private func pinched(_ recognizer: UIPinchGestureRecognizer) {
		switch recognizer.state {
		case .began:
			lastPinchScale = 1
		case .changed:
			let factor = recognizer.scale / lastPinchScale
			lastPinchScale = recognizer.scale
			let rect = pictureRect
			let location = recognizer.location(in: self)
			viewport = viewport.transformed(factor: factor, focusX: location.x - rect.minX, focusY: location.y - rect.minY, moveX: 0, moveY: 0, width: rect.width, height: rect.height)
			applyViewport()
		default:
			break
		}
	}

	@objc private func twoFingersMoved(_ recognizer: UIPanGestureRecognizer) {
		let translation = recognizer.translation(in: self)
		switch recognizer.state {
		case .began:
			lastTwoFingerTranslation = translation
		case .changed:
			let rect = pictureRect
			let location = recognizer.location(in: self)
			viewport = viewport.transformed(
				factor: 1, focusX: location.x - rect.minX, focusY: location.y - rect.minY,
				moveX: translation.x - lastTwoFingerTranslation.x, moveY: translation.y - lastTwoFingerTranslation.y,
				width: rect.width, height: rect.height
			)
			lastTwoFingerTranslation = translation
			applyViewport()
		default:
			break
		}
	}

	private func moveCursor(dx: CGFloat, dy: CGFloat, speed: CGFloat) {
		let rect = pictureRect
		guard let move = trackpad.move(dx: dx, dy: dy, speed: speed, width: rect.width * viewport.zoom, height: rect.height * viewport.zoom) else { return }
		onInput([move])
		viewport = viewport.following(x: trackpad.cursor.x, y: trackpad.cursor.y, width: rect.width, height: rect.height, margin: 24)
		applyViewport()
	}
}

/// A classic arrow pointer, larger than a desktop's and outlined so it shows on any
/// background; its tip is its position.
private func makeCursor() -> CAShapeLayer {
	let cursor = CAShapeLayer()
	let scale: CGFloat = 1.5
	let points: [CGPoint] = [
		CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 22), CGPoint(x: 5.5, y: 17), CGPoint(x: 9.5, y: 26),
		CGPoint(x: 13.5, y: 24.2), CGPoint(x: 9.6, y: 15.5), CGPoint(x: 16.5, y: 15.5),
	]
	let path = UIBezierPath()
	path.move(to: points[0])
	for point in points.dropFirst() { path.addLine(to: point) }
	path.close()
	path.apply(CGAffineTransform(scaleX: scale, y: scale))
	cursor.path = path.cgPath
	cursor.bounds = CGRect(x: 0, y: 0, width: 17 * scale, height: 26 * scale)
	cursor.anchorPoint = .zero
	cursor.fillColor = UIColor.white.cgColor
	cursor.strokeColor = UIColor.black.cgColor
	cursor.lineWidth = 1.5
	cursor.lineJoin = .round
	cursor.shadowColor = UIColor.black.cgColor
	cursor.shadowOpacity = 0.35
	cursor.shadowRadius = 2
	cursor.shadowOffset = CGSize(width: 0, height: 1)
	cursor.zPosition = 10
	return cursor
}
