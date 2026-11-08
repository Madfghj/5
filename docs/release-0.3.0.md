# OpenCalendar 0.3.0 — 8 November 2026

The calendar now opens a short group availability form when a day cell is pressed. Each member can save Yes / Not sure / No, an optional half-hour time from 08:00 through 20:00 and a note of up to 280 characters. Members see the respondent's name and avatar. Availability belongs to the group and is removed when membership ends.

Real sessions start with an empty loading state and fetch their own profile. Public and native production builds do not offer or restore a demo account. A developer demo requires an explicit choice in a development build.

Personal space contains name, language, four pixel avatars, independent color and background choices, and a short personal caption. Advanced Settings controls the initial calendar view, motion, density and presence. Connection services have their own top-bar panel. The large Create group card is retained in Groups. Promotional banners and the small bottom logo were removed; text sizes and contrast were increased.

Presence reports Online, Away, Do not disturb or Offline. The app sends a heartbeat while visible and an explicit leave request when hidden or closed. Abrupt disconnection falls back to a 90-second expiry. Presence is currently per user: closing one device can briefly hide another device until its next heartbeat, at most 30 seconds under normal connectivity.

## Sign-in status

- Google Web OAuth is configured in hosted server secrets and was verified through a real browser callback and successful session exchange on 7 November. Native Google return still needs a physical-device check.
- Microsoft and Telegram OIDC implementations require owner-side client registration and server credentials. Telegram uses Login Widget Client ID/Secret, not the Bot API token.
- Apple needs a developer configuration, primary App ID, Services ID and signing key. The owner has not yet enrolled in a developer program.
- Signal is an optional validated contact link, not a verified sign-in method.
- Proton Mail addresses use ordinary email sign-in with a separate OpenCalendar password. An existing signed-in profile can add email credentials without creating or merging accounts. Email remains explicitly unverified; delivery/reset services are not configured.

## Validation and distribution

60 automated checks pass, including cloud/local authorization, availability, presence, customization, email linking, real signed OIDC claims and production bootstrap isolation. TypeScript, web/mobile bundles, Capacitor synchronization and Android/iOS preflight checks pass. Browser checks covered day selection, saving time/notes, profile reload, theme persistence and DND. Android debug compilation has succeeded on Windows using Java 21, API 36 and Build Tools 35.0.0.

The Android APK is a test build, not a Google Play release. No physical Android/iOS device run, signed release AAB/IPA, TestFlight upload or store publication has been completed. The hosted Worker and D1 run independently of the owner's computer. A domain without the hosting provider's name is deferred at the owner's request.
