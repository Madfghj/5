# OpenCalendar.space

A shared calendar for groups, with English, Russian, German and French interfaces. Pick a day, answer yes / maybe / no, choose a time and leave a note. Group members see each other's names and responses.

**[Download apps · GitHub Releases](https://github.com/Madfghj/5/releases)** · **[Open the online calendar](https://opencalendar-space-live.optimisticraccoon.chatgpt.site/)** · **[Download page](https://opencalendar-space-live.optimisticraccoon.chatgpt.site/downloads.html)**

## Downloads

Open **Releases** in this repository and expand **Assets**. Download only the package for your device. A release lists the files that have actually finished building; source archives alone are not installable apps.

| Device | Package | Status |
| --- | --- | --- |
| Android | `.apk` | Test APK. Install over the previous OpenCalendar test version to preserve local settings. |
| Windows 10 / 11, x64 | `.exe` installer | Desktop beta; publisher signature is not yet verified. |
| macOS Monterey 12+, Intel / Apple silicon | `.dmg` or macOS app `.zip` | Universal desktop test build; ad-hoc signed, not Apple-notarized. |
| Linux, x86_64 | `.deb` or `.AppImage` | Desktop beta. See each release for system requirements. |
| iPhone / iPad | Not available for device installation yet | Apple signing and TestFlight / App Store setup are still required. An iOS Simulator archive is only for development on a Mac. |

See the release notes and SHA-256 checksums beside the downloads. These test downloads are separate from App Store, Google Play or Microsoft Store publication. Native device testing is still in progress.

## Development

Node.js 24+ and pnpm 11.25.0 are required.

```sh
pnpm install --frozen-lockfile
pnpm run db:migrate
pnpm run dev
```

Open `http://127.0.0.1:5174`. The local API runs on port 8788; development D1 data stays in `.wrangler/state`.

```sh
pnpm test
pnpm run build
```

The hosted API and database run independently of your computer. Native clients use the public HTTPS API configured in `mobile.config.json` (or `VITE_API_URL`). API credentials and signing keys belong in server/CI secrets, never in the client or repository.

### Android and iOS

```sh
pnpm run build:mobile
pnpm run cap:sync
pnpm run check:android
pnpm run check:ios
```

The Capacitor projects are in `android/` and `ios/`. Android compilation requires Java 21 and the Android SDK. iOS compilation requires a compatible Mac/Xcode toolchain. Physical iOS distribution requires the owner's Apple signing setup. CI simulator builds do not produce an installable iPhone app.

### Desktop

```sh
pnpm run build:desktop
pnpm run desktop:dev
pnpm run desktop:build
```

The Tauri 2 project is in `src-tauri/`, with Rust 1.90 and a locked dependency graph. Install the native build prerequisites for your OS. GitHub Actions builds the desktop packages on the corresponding native runners and checks the package identity and version. The macOS workflow also checks both architectures, the macOS 12 minimum and the ad-hoc signature.

## Accounts and current limits

Email registration is available; email delivery and password recovery are not configured yet. Google and Telegram login are configured on the hosted service. Apple and Microsoft login require further owner/provider setup. Signal and Proton Mail are not presented as working third-party OAuth providers.

Groups refresh changes periodically. Meeting times are shared local times, so groups across time zones should agree on a time zone. Store publication still requires developer accounts, signing, privacy/review work and real-device validation.

Documentation: [Russian introduction](README.ru.md), [cloud deployment](docs/online-deployment.md), [native distribution](docs/native-release.md), [desktop changes](docs/release-0.3.3.md), [messenger authentication](docs/messenger-auth.md).

Support: [mariel.huber@protonmail.com](mailto:mariel.huber@protonmail.com) · Developer: Mariel Huber
