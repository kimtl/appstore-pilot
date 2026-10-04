import AVFoundation
import CoreImage
import Foundation
import Observation

/// AVCaptureSession 을 감싸는 카메라 서비스.
/// - 미리보기 프레임은 `latestFrame` 으로 렌더 스레드에 넘기고
/// - 촬영은 `capturePhoto()` 로 async 하게 원본 데이터를 돌려준다.
@Observable
final class CameraService: NSObject {
    enum Status: Equatable {
        case idle
        case running
        case unauthorized
        case failed(String)
    }

    enum CameraError: LocalizedError {
        case noCamera
        case cannotAddInput
        case cannotAddOutput
        case captureFailed
        case busy

        var errorDescription: String? {
            switch self {
            case .noCamera: return "사용할 수 있는 카메라가 없어요."
            case .cannotAddInput, .cannotAddOutput: return "카메라를 준비하지 못했어요."
            case .captureFailed: return "사진을 찍지 못했어요. 다시 시도해 주세요."
            case .busy: return "이전 촬영이 아직 끝나지 않았어요."
            }
        }
    }

    private(set) var status: Status = .idle
    private(set) var position: AVCaptureDevice.Position = .back
    var flashMode: AVCaptureDevice.FlashMode = .off

    @ObservationIgnored let session = AVCaptureSession()
    @ObservationIgnored private let sessionQueue = DispatchQueue(label: "dica.camera.session")
    @ObservationIgnored private let videoQueue = DispatchQueue(label: "dica.camera.video", qos: .userInteractive)
    @ObservationIgnored private let photoOutput = AVCapturePhotoOutput()
    @ObservationIgnored private let videoOutput = AVCaptureVideoDataOutput()
    @ObservationIgnored private var videoInput: AVCaptureDeviceInput?
    @ObservationIgnored private var currentPosition: AVCaptureDevice.Position = .back
    @ObservationIgnored private var isConfigured = false

    @ObservationIgnored private let lock = NSLock()
    @ObservationIgnored private var _latestFrame: CIImage?
    @ObservationIgnored private var captureContinuation: CheckedContinuation<Data, Error>?

    /// 가장 최근 미리보기 프레임 (세로 방향으로 회전된 상태). 어느 스레드에서든 읽을 수 있다.
    var latestFrame: CIImage? {
        lock.lock()
        defer { lock.unlock() }
        return _latestFrame
    }

    // MARK: - 수명 주기

    func start() async {
        let granted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            granted = true
        case .notDetermined:
            granted = await AVCaptureDevice.requestAccess(for: .video)
        default:
            granted = false
        }
        guard granted else {
            status = .unauthorized
            return
        }

        sessionQueue.async { [self] in
            do {
                if !isConfigured {
                    try configureSession()
                    isConfigured = true
                }
                if !session.isRunning {
                    session.startRunning()
                }
                publish { $0.status = .running }
            } catch {
                publish { $0.status = .failed(error.localizedDescription) }
            }
        }
    }

    func pause() {
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func resume() {
        sessionQueue.async { [self] in
            if isConfigured, !session.isRunning { session.startRunning() }
        }
    }

    func switchCamera() {
        sessionQueue.async { [self] in
            let next: AVCaptureDevice.Position = currentPosition == .back ? .front : .back
            session.beginConfiguration()
            do {
                try addInput(for: next)
                updateConnections()
            } catch {
                publish { $0.status = .failed(error.localizedDescription) }
            }
            session.commitConfiguration()
        }
    }

    // MARK: - 촬영

    func capturePhoto() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                let alreadyCapturing = lock.withLock { () -> Bool in
                    if captureContinuation != nil { return true }
                    captureContinuation = continuation
                    return false
                }
                if alreadyCapturing {
                    continuation.resume(throwing: CameraError.busy)
                    return
                }

                let settings: AVCapturePhotoSettings
                if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
                    settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                } else {
                    settings = AVCapturePhotoSettings()
                }
                settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
                settings.photoQualityPrioritization = .balanced
                if photoOutput.supportedFlashModes.contains(flashMode) {
                    settings.flashMode = flashMode
                }
                photoOutput.capturePhoto(with: settings, delegate: self)
            }
        }
    }

    // MARK: - 세션 구성

    private func configureSession() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }

        session.sessionPreset = .photo
        try addInput(for: .back)

        guard session.canAddOutput(photoOutput) else { throw CameraError.cannotAddOutput }
        session.addOutput(photoOutput)
        photoOutput.maxPhotoQualityPrioritization = .balanced

        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
        guard session.canAddOutput(videoOutput) else { throw CameraError.cannotAddOutput }
        session.addOutput(videoOutput)

        updateConnections()
    }

    private func addInput(for newPosition: AVCaptureDevice.Position) throws {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: newPosition)
        else { throw CameraError.noCamera }
        let input = try AVCaptureDeviceInput(device: device)

        let previous = videoInput
        if let previous { session.removeInput(previous) }

        guard session.canAddInput(input) else {
            if let previous, session.canAddInput(previous) { session.addInput(previous) }
            throw CameraError.cannotAddInput
        }
        session.addInput(input)
        videoInput = input
        currentPosition = newPosition
        publish { $0.position = newPosition }
    }

    /// 세로 방향 고정, 전면 카메라는 미리보기와 결과물 모두 거울 반전, 최대 해상도 설정.
    private func updateConnections() {
        let mirrored = currentPosition == .front
        let connections = [photoOutput.connection(with: .video), videoOutput.connection(with: .video)].compactMap { $0 }
        for connection in connections {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = mirrored
            }
        }
        if let device = videoInput?.device,
           let dimensions = device.activeFormat.supportedMaxPhotoDimensions.last {
            photoOutput.maxPhotoDimensions = dimensions
        }
    }

    private func publish(_ update: @escaping (CameraService) -> Void) {
        DispatchQueue.main.async { update(self) }
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension CameraService: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        let continuation = lock.withLock { () -> CheckedContinuation<Data, Error>? in
            let pending = captureContinuation
            captureContinuation = nil
            return pending
        }
        if let error {
            continuation?.resume(throwing: error)
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            continuation?.resume(throwing: CameraError.captureFailed)
            return
        }
        continuation?.resume(returning: data)
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        lock.lock()
        _latestFrame = image
        lock.unlock()
    }
}

// 공유 상태는 sessionQueue 와 NSLock 으로 보호하므로 스레드 간 전달이 안전하다.
extension CameraService: @unchecked Sendable {}
