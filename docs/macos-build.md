# OpenCalendar для Intel Mac на macOS Monterey

Целевая система — macOS 12.0+; универсальное приложение включает Intel `x86_64` и Apple silicon `arm64`. Для MacBook 2016 и Intel Mac под Monterey используется самостоятельный Tauri 2 desktop target, а не iPad-приложение «Designed for iPad». Идентификатор — `space.opencalendar.app`, интерфейс и шрифты входят в приложение, данные групп и вход обслуживает существующий облачный API.

Статус: исходники, конфигурация, Cargo.lock и ручной workflow подготовлены. Создание этих файлов и проверка метаданных на Windows не означают успешной macOS-компиляции или запуска на Monterey. Готовый `.app`/DMG можно объявить собранным только после успешного native CI и проверки его артефактов.

## Почему отдельная оболочка

Официальные SPM-архивы Capacitor/Cordova 8.6.0, используемые iOS-проектом, содержат iOS device и iOS Simulator, но не Mac Catalyst ABI. Наличие `x86_64` внутри Simulator не превращает его в Intel macOS framework. Поэтому изменение одного Catalyst-флага не даёт Mac-приложение. Состав опубликованных архивов сверялся с контрольными суммами [официального Package.swift](https://github.com/ionic-team/capacitor-swift-pm/blob/8.6.0/Package.swift).

Tauri позволяет собрать macOS `.app` с [минимальной системой 12.0](https://v2.tauri.app/distribute/macos-application-bundle/) и [обеими архитектурами](https://v2.tauri.app/reference/cli/). Современный Electron 44+ требует macOS 13; фиксировать старый Chromium только ради Monterey здесь не требуется. [Изменение поддержки Electron](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support).

## Локальная сборка на подходящем Mac

Нужны Node.js 24+, pnpm 11.25.0, Rust 1.90.0 и Xcode 26 с macOS SDK, сохраняющим Intel target. Xcode 26 не нужно устанавливать на старый Monterey Mac: сборка выполняется на подходящем другом Mac или macOS runner; пользователь получает скомпилированный пакет с minimum deployment target 12.0.

```sh
pnpm install --frozen-lockfile
rustup toolchain install 1.90.0 --profile minimal
rustup target add --toolchain 1.90.0 x86_64-apple-darwin aarch64-apple-darwin
RUSTUP_TOOLCHAIN=1.90.0 MACOSX_DEPLOYMENT_TARGET=12.0 pnpm exec tauri build --ci --target universal-apple-darwin --bundles app,dmg -- --locked
```

`beforeBuildCommand` запускает `pnpm run build:desktop`, который создаёт `dist-desktop`. Native target не загружает удалённый сайт вместо интерфейса. Для разработки используются `pnpm exec tauri dev`, `dev:desktop` и `http://127.0.0.1:5176`.

Прямые Rust dependencies закреплены на стабильных версиях 2.x; `src-tauri/Cargo.lock` фиксирует транзитивные зависимости. `.cargo/config.toml` использует MSRV fallback при обновлении из каталога `src-tauri`. Не обновляйте lockfile в CI и не добавляйте `--ignore-version-mismatches` для сокрытия реального конфликта.

Ожидаемые результаты:

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/OpenCalendar.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

Собственный `.icns` и PNG-иконки уже включены в `src-tauri/icons`. Они получены из существующего утверждённого изображения; повторная упаковка — `node src-tauri/scripts/generate-icons.mjs`.

## Ручной GitHub Actions

Workflow **Mac desktop test build** запускается только через `workflow_dispatch`. Автоматического запуска при push/PR, отправки в App Store или создания GitHub Release нет. Перед первым запуском нужно разрешение владельца на публикацию выбранных исходников в репозитории и использование Actions. Реальный runner и его доступный allowance проверяются до запуска; бесплатная бессрочная компиляция не обещается.

Workflow выбирает установленный Xcode 26 на `macos-26`, проверяет shared build/tests, устанавливает закреплённый Rust toolchain и обе архитектуры, собирает App/DMG с `--locked`. Затем проверяет:

- Bundle ID, версию, регистрацию OAuth scheme и `LSMinimumSystemVersion = 12.0`;
- Intel `x86_64` и Apple silicon `arm64` через `lipo`;
- `LC_BUILD_VERSION` / `minos` 12.0 у каждой архитектуры;
- целостность ad-hoc подписи через `codesign`;
- наличие DMG, размер и SHA-256 передаваемых файлов.

App упаковывается через `ditto`, чтобы сохранить структуру bundle. ZIP, DMG и `native-verification.json` сохраняются как artifact на семь дней. Отчёт отдельно сообщает, что приложение не notarized, не опубликовано в магазине и ещё не проверено на Monterey. [Состав macOS runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md).

## Полномочия приложения

Только локальное окно `main` получает IPC. Remote URLs не получают capability и не открываются внутри доверенного webview. CSP разрешает встроенные scripts/fonts/assets и обращения к точному HTTPS API origin; новые окна и внешняя навигация блокируются native-кодом. Ссылки на разрешённые HTTPS-сервисы открываются явным вызовом системного браузера.

Разрешены получение входящего auth URL, события focus/close, запись текста в clipboard и экспорт через Save dialog. Статических прав читать диск, произвольных файловых wildcard scopes и shell-команд нет. Dialog выдаёт runtime scope только для выбранного пользователем пути; `fs:allow-write-text-file` позволяет записать экспорт туда. [Tauri capabilities](https://v2.tauri.app/reference/acl/capability/), [Save dialog](https://v2.tauri.app/plugin/dialog/).

OAuth возвращается через `space.opencalendar.app://auth`. Frontend обрабатывает холодный старт и уже запущенное приложение, проверяет URL и выполняет одноразовый PKCE exchange. Native-код поднимает окно только для ожидаемого auth scheme/host и не пишет коды/токены в логи. Sign-in провайдеров остаётся доступен только при реальной серверной настройке.

После закрытия главного окна приложение завершает процесс. Это происходит после ограниченного по времени frontend presence-leave и уничтожения окна; невидимый постоянный процесс не остаётся. Повторное открытие из Dock запускает новое окно с сохранённой локальной сессией.

API должен разрешать точный desktop webview origin в CORS. Изменение API origin требует согласованного обновления frontend build, CSP, opener scope и серверного allowlist. Не расширяйте их до `*`.

## Подпись и реальная установка

Текущая конфигурация задаёт `signingIdentity: "-"`: это ad-hoc тестовая подпись без подтверждённой Apple личности. Она не заменяет Developer ID, notarization или Mac App Store approval. Тестовый DMG нельзя представлять как доверенный готовый дистрибутив; загрузка через браузер может быть остановлена штатной защитой macOS. Workflow не отключает Gatekeeper, не удаляет quarantine и не меняет настройки безопасности. [Подпись macOS в Tauri](https://v2.tauri.app/distribute/sign/macos/).

Для обычного распространения вне магазина потребуются сертификат владельца Developer ID Application и notarization. Для Mac App Store нужен другой подписанный пакет, App Store Connect, sandbox/entitlements, профиль и материалы магазина. Эти действия не выполнялись этим workflow. iPhone/iPad по-прежнему собираются из отдельного iOS target.

## Что проверить на пользовательском Monterey Mac

Исполняемый файл с `minos 12.0` подтверждает deployment target, но не доказывает совместимость всех действий с конкретным WebKit Monterey. Нужны фактические проверки: запуск, английский первый экран и все четыре языка, текст и темы, сохранение сессии после перезапуска, создание/вступление в группу, ответы и имена двух участников, переключение presence, Save/Cancel экспорта, clipboard, системный OAuth и возврат при открытом/закрытом приложении. Для браузерного движка Monterey особенно важна проверка crypto и CSS, а не только успешная компиляция. [Зависимость Tauri от системного WebKit](https://v2.tauri.app/reference/webview-versions/).

Модель Mac, точная macOS/WebKit, версия приложения и результат каждого сценария должны попасть в отчёт QA. Не нужно обновлять ОС, обходить защиту или покупать новый Mac для получения исходного проекта; облачная компиляция и доставка корректно подписанного пакета — самостоятельные шаги.
