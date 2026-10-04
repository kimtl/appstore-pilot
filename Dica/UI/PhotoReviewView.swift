import SwiftUI

/// 방금 찍은 사진을 크게 보고 공유하는 화면.
struct PhotoReviewView: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            }
            .toolbarBackground(.black, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    ShareLink(
                        item: Image(uiImage: image),
                        preview: SharePreview("디카", image: Image(uiImage: image))
                    )
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
