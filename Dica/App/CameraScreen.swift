import AVFoundation
import SwiftUI

/// 메인 화면. 위: 플래시/스탬프/가져오기, 가운데: 3:4 뷰파인더, 아래: 썸네일/셔터/전환.
struct CameraScreen: View {
    enum ShootError: LocalizedError {
        case render
        var errorDescription: String? { "사진을 현상하지 못했어요." }
    }

    @State private var camera = CameraService()
    @AppStorage("dateStampEnabled") private var dateStampEnabled = true
    @State private var lastPhoto: UIImage?
    @State private var lastThumbnail: UIImage?
    @State private var isShooting = false
    @State private var flashOverlay = false
    @State private var showImport = false
    @State private var showReview = false
    @State private var errorMessage: String?
    @Environment(\.scenePhase) private var scenePhase

    private let look = LookSettings.default

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                Spacer(minLength: 12)
                viewfinder
                    .padding(.horizontal, 8)
                Spacer(minLength: 12)
                bottomBar
                    .padding(.horizontal, 32)
                    .padding(.bottom, 16)
            }
        }
        .task { await camera.start() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: camera.resume()
            case .background: camera.pause()
            default: break
            }
        }
        .sheet(isPresented: $showImport) {
            ImportView(look: look, dateStampEnabled: dateStampEnabled)
        }
        .fullScreenCover(isPresented: $showReview) {
            if let lastPhoto {
                PhotoReviewView(image: lastPhoto)
            }
        }
        .alert("문제가 생겼어요", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("확인", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - 상단

    private var topBar: some View {
        HStack(spacing: 24) {
            Button(action: cycleFlash) {
                Image(systemName: flashSymbol)
                    .font(.title2)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("플래시")

            Button { dateStampEnabled.toggle() } label: {
                Text(DateStamp.text(for: .now))
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(dateStampEnabled ? DateStamp.color : .white.opacity(0.35))
                    .frame(height: 44)
            }
            .accessibilityLabel(dateStampEnabled ? "날짜 스탬프 끄기" : "날짜 스탬프 켜기")

            Spacer()

            Button { showImport = true } label: {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.title2)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("앨범에서 가져오기")
        }
        .foregroundStyle(.white)
    }

    private var flashSymbol: String {
        switch camera.flashMode {
        case .on: return "bolt.fill"
        case .auto: return "bolt.badge.automatic.fill"
        default: return "bolt.slash"
        }
    }

    private func cycleFlash() {
        switch camera.flashMode {
        case .off: camera.flashMode = .on
        case .on: camera.flashMode = .auto
        default: camera.flashMode = .off
        }
    }

    // MARK: - 뷰파인더

    private var viewfinder: some View {
        ZStack(alignment: .bottomTrailing) {
            CameraPreviewView(camera: camera, look: look)
            if dateStampEnabled {
                DateStampLabel(date: .now)
                    .padding(14)
            }
            if flashOverlay {
                Color.white
            }
            statusOverlay
        }
        .aspectRatio(3 / 4, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    @ViewBuilder
    private var statusOverlay: some View {
        switch camera.status {
        case .unauthorized:
            VStack(spacing: 12) {
                Text("카메라 접근을 허용해 주세요")
                    .font(.headline)
                Button("설정 열기") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black.opacity(0.85))
        case .failed(let message):
            Text(message)
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black.opacity(0.85))
        default:
            EmptyView()
        }
    }

    // MARK: - 하단

    private var bottomBar: some View {
        HStack {
            Button { if lastPhoto != nil { showReview = true } } label: {
                Group {
                    if let lastThumbnail {
                        Image(uiImage: lastThumbnail)
                            .resizable()
                            .scaledToFill()
                    } else {
                        Color.white.opacity(0.1)
                    }
                }
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .accessibilityLabel("마지막 사진 보기")

            Spacer()

            ShutterButton(isBusy: isShooting) { shoot() }

            Spacer()

            Button { camera.switchCamera() } label: {
                Image(systemName: "arrow.triangle.2.circlepath.camera")
                    .font(.title2)
                    .frame(width: 52, height: 52)
            }
            .accessibilityLabel("카메라 전환")
        }
        .foregroundStyle(.white)
    }

    // MARK: - 촬영

    @MainActor
    private func shoot() {
        guard !isShooting, camera.status == .running else { return }
        isShooting = true
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()

        Task {
            defer { isShooting = false }
            do {
                let data = try await camera.capturePhoto()

                flashOverlay = true
                try? await Task.sleep(for: .milliseconds(70))
                flashOverlay = false

                let stampDate: Date? = dateStampEnabled ? .now : nil
                let look = look
                let rendered = await Task.detached(priority: .userInitiated) {
                    LookRenderer.shared.renderStill(from: data, look: look, stampDate: stampDate)
                }.value
                guard let image = rendered else { throw ShootError.render }

                try await PhotoSaver.save(image)
                lastPhoto = image
                lastThumbnail = image.preparingThumbnail(of: CGSize(width: 160, height: 160))
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
