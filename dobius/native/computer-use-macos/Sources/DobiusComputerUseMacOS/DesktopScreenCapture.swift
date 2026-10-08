import AppKit
import CoreGraphics
import CoreImage
import Foundation
import ScreenCaptureKit

// Display-only path: never builds an Accessibility tree or requests permission remotely.
func desktopScreenStatus() {
    let display = CGMainDisplayID()
    let result: [String: Any] = ["granted": CGPreflightScreenCaptureAccess(), "id": display,
        "width": Int(CGDisplayBounds(display).width), "height": Int(CGDisplayBounds(display).height)]
    if let data = try? JSONSerialization.data(withJSONObject: result) {
        print(String(decoding: data, as: UTF8.self))
    }
}

final class DesktopScreenOutput: NSObject, SCStreamOutput, @unchecked Sendable {
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let display: UInt32
    private let width: Int
    private let height: Int
    private var sequence: UInt32 = 0
    init(display: UInt32, width: Int, height: Int) {
        self.display = display; self.width = width; self.height = height
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
            let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
            let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
            let buffer = sample.imageBuffer else { return }
        // Serial sample queue and queueDepth=2 bound encoding; no per-frame process or main-thread wait.
        autoreleasepool {
            let image = CIImage(cvPixelBuffer: buffer)
            guard let cg = context.createCGImage(image, from: image.extent),
                cg.width == width, cg.height == height else { return }
            let bitmap = NSBitmapImageRep(cgImage: cg)
            guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.6]),
                !jpeg.isEmpty, jpeg.count <= 1024 * 1024 else { return }
            sequence &+= 1
            var packet = Data()
            func append<T: FixedWidthInteger>(_ number: T) {
                var little = number.littleEndian
                withUnsafeBytes(of: &little) { packet.append(contentsOf: $0) }
            }
            append(UInt32(jpeg.count)); append(display)
            append(UInt16(width)); append(UInt16(height)); append(sequence)
            packet.append(jpeg)
            // stdout is a private binary pipe to the owner, never a diagnostic/log stream.
            do { try FileHandle.standardOutput.write(contentsOf: packet) }
            catch { exit(0) }
        }
    }
}

@MainActor
final class DesktopScreenRuntime: NSObject, NSApplicationDelegate, SCStreamDelegate {
    private let width: Int
    private let fps: Int
    private var capture: SCStream?
    private var output: DesktopScreenOutput?
    init(width: Int, fps: Int) { self.width = width; self.fps = fps }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            guard CGPreflightScreenCaptureAccess() else { exit(2) }
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { exit(3) }
                let bounds = CGDisplayBounds(display.displayID)
                let width = max(1, Int(floor(min(Double(self.width), bounds.width,
                    1280.0 * bounds.width / bounds.height))))
                let height = max(1, Int(floor(Double(width) * bounds.height / bounds.width)))
                let config = SCStreamConfiguration()
                config.width = width; config.height = height
                config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
                config.queueDepth = 2; config.capturesAudio = false
                config.pixelFormat = kCVPixelFormatType_32BGRA
                let filter = SCContentFilter(display: display, excludingWindows: [])
                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                let output = DesktopScreenOutput(display: display.displayID, width: width, height: height)
                self.capture = stream; self.output = output
                try stream.addStreamOutput(output, type: .screen,
                    sampleHandlerQueue: DispatchQueue(label: "dobius.screen.jpeg", qos: .userInitiated))
                try await stream.startCapture()
            } catch { exit(3) }
        }
        // Losing the parent pipe closes capture even if its Stop IPC never arrives.
        DispatchQueue.global(qos: .utility).async {
            _ = try? FileHandle.standardInput.readToEnd()
            exit(0)
        }
    }
    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        exit(3) // Fixed exit only; never serialize capture exceptions.
    }
}

@MainActor
func runDesktopScreenCapture(arguments: [String]) {
    guard arguments.count == 3, let width = Int(arguments[1]), let fps = Int(arguments[2]),
        width >= 1, width <= 1280, fps >= 1, fps <= 10 else { exit(4) }
    guard CGPreflightScreenCaptureAccess() else { exit(2) }
    let app = NSApplication.shared
    let delegate = DesktopScreenRuntime(width: width, fps: fps)
    app.setActivationPolicy(.prohibited)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}

func enableDesktopScreenCapture() {
    _ = CGRequestScreenCaptureAccess() // Only the explicit local setup action invokes this mode.
}
