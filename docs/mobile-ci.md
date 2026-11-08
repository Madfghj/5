# Мобильные сборки в GitHub Actions

Файлы в `.github/workflows/` подготавливают настоящую компиляцию Android и iOS в подходящих средах. Они ещё не запускались в GitHub и не подтверждают наличие готовых APK/AAB/IPA.

Репозиторий должен содержать проект OpenCalendar в корне. Перед запуском владелец проверяет настройки доступа репозитория, условия используемых SDK и лимиты GitHub Actions. Workflows запускаются вручную через **Actions → Run workflow**; автоматического запуска на чужом pull request или автоматической отправки в магазины нет.

## Проверочная сборка

Выберите **Mobile test builds**:

- `android` создаёт `app-debug.apk` для установки и тестирования Android. Сборка использует стандартную отладочную подпись; Google Play её не принимает.
- `ios` создаёт неподписанное `App.app` для iOS Simulator на Mac. Это не IPA для установки на iPhone и не файл для App Store.
- `both` запускает обе платформы после общей проверки кода.

Поле `api_url` содержит публичный HTTPS-адрес API без `/api`. Оно заранее заполнено действующим адресом OpenCalendar. `VITE_API_URL` публичен и не должен содержать секретов. Мобильный интерфейс собирается через `build:mobile`, затем копируется в оболочку через `cap sync`. `scripts/ci-native-check.mjs` проверяет, что адрес действительно попал в bundle, идентификаторы и версии совпадают, а возврат OAuth настроен на обеих платформах.

Проверочный Android-job использует Java 21 и уже установленный Android SDK GitHub runner. В workflow нет `yes | sdkmanager --licenses` или скрытого принятия лицензий. Если API 36 отсутствует, job останавливается с понятной ошибкой. На текущем Windows-ПК Java 21 и Android SDK установлены в изолированную папку, APK и подписанный AAB уже собраны; Xcode здесь запустить нельзя. [Среда Capacitor 8](https://capacitorjs.com/docs/getting-started/environment-setup), [образ Ubuntu runner](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [образ macOS 26](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md).

## Подписанные архивы

Создайте в GitHub Environment `mobile-release`, ограничьте разрешённую ветку и добавьте required reviewers. Помещайте секреты именно туда. Затем используйте **Mobile signed archives**. При нехватке ключей job завершается до компиляции и не выдаёт неподписанный файл за релизный.

Для Android нужны:

| Secret | Значение |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 содержимого собственного upload-keystore |
| `ANDROID_STORE_PASSWORD` | Пароль keystore |
| `ANDROID_KEY_ALIAS` | Alias upload-ключа |
| `ANDROID_KEY_PASSWORD` | Пароль ключа |

Результат — подписанный `app-release.aab`. Upload-ключ декодируется только во временную папку runner и удаляется в завершающем шаге. Пароли читаются Gradle из переменных окружения; они не записываются в проект или аргументы Gradle. AAB проверяется `jarsigner` и наличием подписи в архиве. [Подпись Android](https://developer.android.com/studio/publish/app-signing).

Для iOS нужны:

| Secret | Значение |
| --- | --- |
| `APPLE_CERTIFICATE_BASE64` | Base64 собственного Apple Distribution `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Пароль `.p12` |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Base64 App Store provisioning profile для точного Bundle ID |
| `APPLE_TEAM_ID` | ID команды Apple Developer |

Результат — подписанная IPA для загрузки в App Store Connect. Сертификат импортируется во временную keychain, профиль устанавливается только в одноразовой среде runner. Очистка выполняется даже при ошибке. Настройки подписи применяются к целям приложения, а не глобально к зависимостям Swift Package Manager. [Сертификаты Apple](https://developer.apple.com/help/account/certificates/certificates-overview/), [загрузка сборок](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).

Workflows сохраняют только APK/AAB/IPA или simulator ZIP на семь дней. Они не загружают сертификаты, пароли, базы и `.env` как artifacts. Перед передачей подписанного файла тестировщикам или магазину проверьте его вручную на устройствах.

## Что остаётся владельцу аккаунтов

Google Play Console требует аккаунт разработчика и разовый регистрационный платёж US$25. Для новых личных аккаунтов действуют требования закрытого теста: минимум 12 участников непрерывно в течение 14 дней, затем заявка на production-доступ. [Регистрация Play Console](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en), [требования тестирования](https://support.google.com/googleplay/android-developer/answer/14151465).

Apple Developer Program стоит US$99 за год членства либо эквивалент в доступной местной валюте. Для App Store нужны членство, идентификатор приложения, подпись, App Store Connect и проверка магазина. Возможные исключения/освобождения от взноса определяет Apple. [Членство Apple](https://developer.apple.com/programs/whats-included/), [регистрация](https://developer.apple.com/programs/enroll/).

Обычный Apple Account пользователя не заменяет настройки Sign in with Apple у разработчика приложения: нужны primary App ID с соответствующей capability, связанный Services ID, домен/return URL и серверный ключ. [Настройка Apple-входа для сайта](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web).

Контакты поддержки, политика конфиденциальности, сведения о данных, возрастной рейтинг, материалы магазина и проверка реального входа каждого провайдера должны соответствовать выпущенному приложению. Успешная CI-сборка не означает одобрение публикации.

Все actions закреплены на commit SHA официальных `actions/*`, проверенных 7 ноября 2026 года: checkout/setup-node/upload-artifact v7 и setup-java v6. При обновлении проверьте новые releases и замените SHA осознанно.
