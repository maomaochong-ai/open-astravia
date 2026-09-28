import SwiftUI
import UIKit
import VettaKit
@preconcurrency import WebRTC

/// The desktop's screen with the whole phone screen as its trackpad (ADR-0140): one
/// finger moves the pointer from where it is, anywhere on the screen, picture or not; a
/// tap clicks and a two-finger tap right-clicks where the pointer is; holding a finger
/// half a second presses the button, so moving then drags. Two fingers pinch to zoom
/// the picture and move it; the picture never moves otherwise. The pointer is drawn by
/// the phone the moment the finger moves, in the shape the desktop shows.
public struct RemoteScreenView: UIViewRepresentable {
	let track: RTCVideoTrack?
	let interactive: Bool
	/// Room left around the picture for the page's controls; touches there still count.
	let insets: UIEdgeInsets
	/// The desktop's pointer shape; nil draws a plain arrow.
	let cursor: RemoteScreenCursor?
	let onInput: ([RemoteInputCommand]) -> Void

	public init(track: RTCVideoTrack?, interactive: Bool, insets: UIEdgeInsets, cursor: RemoteScreenCursor?, onInput: @escaping ([RemoteInputCommand]) -> Void) {
		self.track = track
		self.interactive = interactive
		self.insets = insets
		self.cursor = cursor
		self.onInput = onInput
	}

	public func makeUIView(context: Context) -> RemoteScreenSurface {
		RemoteScreenSurface()
	}

	public func updateUIView(_ view: RemoteScreenSurface, context: Context) {
		view.onInput = onInput
		view.interactive = interactive
		view.pictureInsets = insets
		view.cursorShape = cursor
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

	var cursorShape: RemoteScreenCursor? {
		didSet {
			guard cursorShape != oldValue else { return }
			cursorImage.contents = cursorShape.flatMap { UIImage(data: $0.image)?.cgImage }
			placeCursor()
		}
	}

	/// A finger has to travel this far before it moves the pointer, so a tap does not nudge it.
	private static let moveThreshold: CGFloat = 3

	private let video = RTCMTLVideoView()
	private let cursorArrow = makeArrow()
	private let cursorImage = CALayer()
	private var track: RTCVideoTrack?
	private var videoSize: CGSize = .zero
	private var viewport = RemoteViewport()
	private var trackpad = RemoteTrackpad()
	/// The one finger moving the pointer, while it is the only finger down.
	private var finger: UITouch?
	private var fingerTravel: CGFloat = 0
	private var lastPinchScale: CGFloat = 1
	private var lastTwoFingerTranslation: CGPoint = .zero
	private let tapFeel = UIImpactFeedbackGenerator(style: .light)
	private let rightFeel = UIImpactFeedbackGenerator(style: .medium)
	private let dragFeel = UIImpactFeedbackGenerator(style: .rigid)

	init() {
		super.init(frame: .zero)
		backgroundColor = .black
		clipsToBounds = true
		isMultipleTouchEnabled = true
		video.videoContentMode = .scaleToFill
		video.delegate = self
		video.isUserInteractionEnabled = false
		addSubview(video)
		cursorImage.contentsGravity = .resize
		cursorImage.zPosition = 10
		for layer in [cursorArrow, cursorImage] {
			layer.isHidden = true
			self.layer.addSublayer(layer)
		}

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
		for recognizer in [tap, rightTap, hold, pinch, twoFingers] as [UIGestureRecognizer] {
			recognizer.delegate = self
			// The finger's own moves keep coming, so the pointer follows it with no delay.
			recognizer.cancelsTouchesInView = false
			recognizer.delaysTouchesEnded = false
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

	/// Puts the pointer's hot spot on the pointer's position, at a readable size.
	private func placeCursor() {
		guard videoSize != .zero else {
			cursorArrow.isHidden = true
			cursorImage.isHidden = true
			return
		}
		let rect = pictureRect
		let shown = viewport.toView(x: trackpad.cursor.x, y: trackpad.cursor.y, width: rect.width, height: rect.height)
		let position = CGPoint(x: rect.minX + shown.x, y: rect.minY + shown.y)
		CATransaction.begin()
		CATransaction.setDisableActions(true)
		if let shape = cursorShape, cursorImage.contents != nil {
			let scale = shape.scale(shownWidth: rect.width * viewport.zoom)
			cursorImage.bounds = CGRect(x: 0, y: 0, width: shape.width * scale, height: shape.height * scale)
			cursorImage.anchorPoint = CGPoint(x: shape.hotspotX / shape.width, y: shape.hotspotY / shape.height)
			cursorImage.position = position
			cursorImage.isHidden = false
			cursorArrow.isHidden = true
		} else {
			cursorArrow.position = position
			cursorArrow.isHidden = false
			cursorImage.isHidden = true
		}
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

	// MARK: One finger: the pointer

	private func fingersDown(_ event: UIEvent?) -> Int {
		event?.allTouches?.count { $0.phase != .ended && $0.phase != .cancelled } ?? 0
	}

	public override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
		super.touchesBegan(touches, with: event)
		if fingersDown(event) == 1, let touch = touches.first {
			finger = touch
			fingerTravel = 0
		} else {
			// A second finger: zooming or right-clicking, not pointing.
			finger = nil
		}
	}

	public override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
		super.touchesMoved(touches, with: event)
		guard interactive, videoSize != .zero, let finger, touches.contains(finger), fingersDown(event) == 1 else { return }
		// Every sample since the last frame, so a fast flick is measured, not skipped.
		let samples = event?.coalescedTouches(for: finger) ?? [finger]
		var dx: CGFloat = 0
		var dy: CGFloat = 0
		for sample in samples {
			let now = sample.location(in: self)
			let before = sample.previousLocation(in: self)
			dx += now.x - before.x
			dy += now.y - before.y
		}
		let span = max((samples.last?.timestamp ?? 0) - (samples.first.map { $0.timestamp } ?? 0), 1.0 / 120)
		fingerTravel += hypot(dx, dy)
		guard fingerTravel >= Self.moveThreshold else { return }
		moveCursor(dx: dx, dy: dy, speed: hypot(dx, dy) / span)
	}

	public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
		super.touchesEnded(touches, with: event)
		if let finger, touches.contains(finger) { self.finger = nil }
	}

	public override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
		super.touchesCancelled(touches, with: event)
		if let finger, touches.contains(finger) { self.finger = nil }
	}

	/// Only the pointer moves: the picture stays where two fingers left it.
	private func moveCursor(dx: CGFloat, dy: CGFloat, speed: CGFloat) {
		let rect = pictureRect
		guard let move = trackpad.move(dx: dx, dy: dy, speed: speed, width: rect.width * viewport.zoom, height: rect.height * viewport.zoom) else { return }
		placeCursor()
		onInput([move])
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

	/// Held half a second: the button goes down where the pointer is; the finger's moves
	/// then drag, and lifting it lets go.
	@objc private func held(_ recognizer: UILongPressGestureRecognizer) {
		switch recognizer.state {
		case .began:
			dragFeel.impactOccurred()
			onInput([trackpad.press(.down)])
		case .ended, .cancelled, .failed:
			onInput([trackpad.press(.up)])
		default:
			break
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
}

/// A plain arrow for a desktop that does not say what its pointer looks like, at a
/// desktop pointer's usual size; its tip is its position.
private func makeArrow() -> CAShapeLayer {
	let arrow = CAShapeLayer()
	let scale: CGFloat = 0.8
	let points: [CGPoint] = [
		CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 22), CGPoint(x: 5.5, y: 17), CGPoint(x: 9.5, y: 26),
		CGPoint(x: 13.5, y: 24.2), CGPoint(x: 9.6, y: 15.5), CGPoint(x: 16.5, y: 15.5),
	]
	let path = UIBezierPath()
	path.move(to: points[0])
	for point in points.dropFirst() { path.addLine(to: point) }
	path.close()
	path.apply(CGAffineTransform(scaleX: scale, y: scale))
	arrow.path = path.cgPath
	arrow.bounds = CGRect(x: 0, y: 0, width: 17 * scale, height: 26 * scale)
	arrow.anchorPoint = .zero
	arrow.fillColor = UIColor.black.cgColor
	arrow.strokeColor = UIColor.white.cgColor
	arrow.lineWidth = 1.2
	arrow.lineJoin = .round
	arrow.zPosition = 10
	return arrow
}
