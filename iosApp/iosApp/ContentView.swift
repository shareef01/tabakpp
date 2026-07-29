import SwiftUI
import composeApp

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        // Kotlin entry shows an explicit "iOS not supported" gate — do not
        // wire Firebase/Koin until a real iOS release target is planned.
        Main_iosKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

struct ContentView: View {
    var body: some View {
        ComposeView()
                .ignoresSafeArea(.all, edges: .bottom)
    }
}
