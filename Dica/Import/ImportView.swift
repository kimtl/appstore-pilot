import PhotosUI
import SwiftUI

/// 앨범의 기존 사진에 디카 룩을 입혀 저장하는 시트.
struct ImportView: View {
    enum ImportError: LocalizedError {
        case load
        case render

        var errorDescription: String? {
            switch self {
            case .load: return "사진을 불러오지 못했어요."
            case .render: return "사진을 현상하지 못했어요."
            }
        }
    }

    let look: LookSettings
    let dateStampEnabled: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var pickerItem: PhotosPickerItem?
    @State private var result: UIImage?
    @State private var isProcessing = false
    @State private var isSaving = false
    @State private var didSave = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let result {
                    Image(uiImage: result)
                        .resizable()
                        .scaledToFit()
                        .padding(8)
                } else if isProcessing {
                    ProgressView("현상 중…")
                        .tint(.white)
                } else {
                    PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                        VStack(spacing: 12) {
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(.system(size: 44))
                            Text("앨범에서 사진을 골라 디카 룩을 입혀요")
                                .font(.subheadline)
                        }
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(32)
                    }
                }
            }
            .navigationTitle("앨범에서 가져오기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.black, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if result != nil {
                        Button(didSave ? "저장됨" : "저장") { save() }
                            .disabled(didSave || isSaving)
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    if result != nil {
                        PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                            Label("다른 사진", systemImage: "photo")
                        }
                    }
                }
            }
            .onChange(of: pickerItem) { _, item in
                guard let item else { return }
                process(item)
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
        .preferredColorScheme(.dark)
    }

    @MainActor
    private func process(_ item: PhotosPickerItem) {
        isProcessing = true
        result = nil
        didSave = false

        Task {
            defer { isProcessing = false }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { throw ImportError.load }
                // 앨범 사진은 오늘이 아니라 찍은 날짜를 스탬프로 넣는다
                let stampDate: Date? = dateStampEnabled ? (ImageMetadata.originalDate(in: data) ?? .now) : nil
                let look = look
                let rendered = await Task.detached(priority: .userInitiated) {
                    LookRenderer.shared.renderStill(from: data, look: look, stampDate: stampDate)
                }.value
                guard let image = rendered else { throw ImportError.render }
                result = image
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func save() {
        guard let result, !isSaving else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await PhotoSaver.save(result)
                didSave = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
