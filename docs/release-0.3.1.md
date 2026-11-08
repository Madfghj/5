# OpenCalendar 0.3.1 — 8 November 2026

This update addresses the language controls, missing/unclear text and nearly identical backgrounds reported on a vivo X80 Pro 5G running Android 15.

Language selection now uses app-owned accessible controls with full English, Русский, Deutsch and Français labels. The onboarding language cards use neutral globe icons instead of code badges. The app bundles Noto Sans and Manrope Latin, Latin Extended and Cyrillic fonts under their OFL licenses; it no longer loads Google Fonts over the network. A new install still starts in English and keeps the user's later choice.

Android now uses a light native theme with Force Dark disabled. Capacitor 8 SystemBars handles CSS safe-area insets and the old-WebView native padding fallback. Shared layout insets protect the top bar, menus, forms and bottom navigation. iOS follows the same light palettes and explicit CSS safe areas; its project is synchronized, but it has not been compiled or run on an Apple device.

Meadow, Forest and Dusk now use three original code-native pixel scenes across Calendar and Groups, with matching customization previews. Translucent paper panels retain text contrast. The default scene remains intentionally simple; the prior generated forest illustration remains in the source assets but is no longer the scene used by the theme.

The local Node server now has Telegram OIDC parity with the hosted Worker, including HTTP Basic client authentication, PKCE, browser-bound state, nonce and signed ID token validation. Synthetic tests cover failure and replay cases. A real Telegram login still needs an owner-managed bot and OIDC credentials; this update does not pretend that setup is complete.

Validation: 61 automated checks pass, including 23 local server checks. TypeScript, web/mobile builds, Capacitor sync and both platform preflights pass. Browser QA covered all four language choices, keyboard selection, onboarding and a 360 px layout, plus visibly different saved Forest and Dusk themes. Android debug compilation succeeded. All 23 bundled client files match the APK byte for byte, including six font subsets and three SVG scenes. The APK has the same signing certificate as 0.3.0 and a higher version code (6), so it supports an in-place update.

No phone/emulator was attached during this verification. The reported vivo runtime, Android vendor font/dark-mode behavior, native OAuth return and real iOS runtime still need device testing. This is a test APK; Google Play, TestFlight and App Store publication are not complete. See release-0.3.0.md for existing presence and email-service limitations.
