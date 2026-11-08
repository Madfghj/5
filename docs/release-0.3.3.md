# OpenCalendar 0.3.3 — Mac desktop candidate

Prepared on 8 November 2026 for Intel Macs running macOS Monterey 12.0+. The new Tauri 2 target reuses the calendar UI and cloud account, with bundled fonts and assets. The planned universal binary contains Intel x86_64 and Apple silicon arm64; those architectures are verified from an actual Mach-O binary by the manual workflow, not inferred from configuration.

The desktop adapter keeps Capacitor's iOS/Android path separate. It opens approved HTTPS links in the system browser, receives cold and running OAuth callbacks through the registered scheme, refreshes presence on focus and close, copies invitations, and saves calendar exports to a file selected by the user. Desktop PKCE retains SHA-256/S256 without depending on WKWebView exposing SubtleCrypto for a custom origin. The API accepts the exact tauri://localhost origin; opaque and lookalike origins remain rejected.

The UI also has Safari 15 fallbacks for dynamic viewport sizing and color mixing. Production first launch remains English, with English, Russian, German and French choices. The original Android 0.3.2 APK and Google Play AAB remain separately frozen artifacts with their verification reports and source ZIP.

Validation completed locally: 71 automated tests, TypeScript, web/Worker, desktop Safari-15-targeted assets, mobile assets, Capacitor synchronization, Android/iOS preflight, Rust locked metadata and Tauri configuration/icon checks. Browser smoke checks preserved Groups and the four-language menu without console errors. No Xcode/macOS compilation or native runtime is claimed by these Windows checks.

The Mac workflow is manual and builds an ad-hoc signed test app and DMG. It checks the real architectures, macOS minimum version, bundle identity, URL scheme and test signature. It does not enroll the owner in a developer program, notarize a distribution, upload to a store or claim a successful Monterey device test. A normal trusted distribution and Mac App Store release still need the owner's signing and store setup, privacy/review work and device validation.
