import Photos
import UIKit

enum PhotoSaver {
    enum SaveError: LocalizedError {
        case denied
        case encoding

        var errorDescription: String? {
            switch self {
            case .denied: return "앨범 저장 권한이 없어요. 설정에서 허용해 주세요."
            case .encoding: return "사진을 저장용으로 변환하지 못했어요."
            }
        }
    }

    /// JPEG(품질 0.92)으로 앨범에 저장한다. 추가 전용 권한만 요청한다.
    static func save(_ image: UIImage) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw SaveError.denied }
        guard let data = image.jpegData(compressionQuality: 0.92) else { throw SaveError.encoding }

        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, data: data, options: nil)
        }
    }
}
