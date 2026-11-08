# OpenCalendar.space — Android, iPhone, iPad и Mac

Проект содержит React-интерфейс и нативные оболочки Capacitor 8. Сервер уже находится в облаке: Cloudflare Worker и база D1 продолжают работать при выключенном ПК. Подписанные приложения для магазинов ещё не собраны и не опубликованы.

## Сборка клиента для телефона

Нужны Node.js 24+ и pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm run build:mobile
pnpm run cap:sync
```

Мобильная сборка использует `dist-mobile`, а не облачный `dist/server`. В `mobile.config.json` задаётся `apiOrigin` — публичный HTTPS-корень API. Переменная `VITE_API_URL` может переопределить его для отдельной сборки. Адрес не должен содержать `/api`, секретов или `localhost`: на телефоне loopback относится к самому телефону.

Проверка перед компиляцией:

```sh
node scripts/ci-native-check.mjs android
node scripts/ci-native-check.mjs ios
```

Проверка отклонит bundle без настоящего онлайн-адреса, разные app ID/версии и пропавший OAuth deep link. Для iOS также проверяются поддержка iPhone и iPad, arm64, английский базовый язык, четыре локализации и непрозрачная иконка 1024 × 1024. Это проверка исходных файлов и bundle, а не успешная компиляция Xcode. Новый клиент нужно пересобирать после смены адреса API. Данные D1 и серверные ключи в приложение не включаются.

При первой установке интерфейс английский. Затем пользователь выбирает один из четырёх языков и переходит к регистрации; выбор сохраняется. Вход по почте работает отдельно от Google. Apple, Google, Microsoft и Telegram становятся доступны после настройки собственных серверных ключей приложения и проверки настоящего входа.

## Android

Для компиляции нужны совместимый Android SDK и Java 21; Android Studio полезна для запуска эмулятора и работы с проектом, но сборка возможна через Gradle CLI. На текущем Windows-ПК Java 21 и SDK уже установлены в `work/toolchains`, отладочный APK компилируется. В проекте используются minimum SDK 24 и target SDK 36; перед отправкой сверяйте требования Play Console. [Требования Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup).

```sh
pnpm run cap:android
```

В Android Studio можно собрать отладочный APK для своего телефона. Для Google Play создаётся подписанный Android App Bundle с собственным upload-ключом. Не добавляйте keystore и пароли в Git. [Выпуск Android](https://developer.android.com/studio/publish), [подпись](https://developer.android.com/studio/publish/app-signing).

## iPhone и iPad

Для компиляции нужен Mac с Xcode 26+ либо соответствующий macOS runner. Windows не может локально собрать iOS-приложение. Swift Package Manager подключает Capacitor и плагины; CocoaPods в текущем проекте не требуется. С 28 апреля 2026 года Apple требует Xcode 26+ и SDK iOS/iPadOS 26+ для загрузки в App Store Connect; minimum deployment target приложения при этом может оставаться iOS 15. [Требования Apple к SDK](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).

```sh
pnpm run cap:ios
```

В Xcode выберите свою команду Apple Developer, проверьте Bundle ID и профиль, протестируйте iPhone/iPad, затем создайте Archive. Simulator `.app` не устанавливается на настоящий iPhone. Для TestFlight/App Store нужны подписанный архив и App Store Connect. [Загрузка сборок Apple](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).

Идентификатор `space.opencalendar.app` предварительный: перед первой регистрацией подтвердите его доступность и окончательное имя приложения. Изменение уже опубликованного Bundle ID создаёт другое приложение.

## MacBook

Первый маршрут — предложить ту же iPhone/iPad-сборку на Mac с Apple silicon через Mac App Store. Отдельная перекомпиляция под macOS для этого режима не требуется; доступность и минимальная версия macOS задаются в App Store Connect. Совместимость нужно проверить на настоящем Mac, прежде чем отмечать её подтверждённой. Этот маршрут не охватывает Intel Mac. [Доступность iOS-приложений на Apple silicon Mac](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-of-iphone-and-ipad-apps-on-macs-with-apple-silicon).

Отдельная macOS-версия, например Mac Catalyst, потребует своей сборки, проверки зависимостей и подписи. Текущий проект не содержит проверенного Catalyst/macOS target. Пошаговая подготовка iPhone/iPad и первого Mac-релиза описана в [apple-release.md](apple-release.md).

## Облачная компиляция

Подготовлены ручные workflows для Android debug APK, iOS simulator и подписанных AAB/IPA. Они сами не публикуют приложение в магазины и не содержат секретов. Подключение и необходимые ключи описаны в [mobile-ci.md](mobile-ci.md).

Для запуска CI нужен репозиторий GitHub под контролем владельца. Видимость исходников и расходование Actions allowance выбираются владельцем отдельно; документ не обещает бессрочно бесплатную macOS-компиляцию.

## Перед отправкой в магазины

- Проверить на двух физических устройствах регистрацию, вход, создание группы, приглашение и все три ответа.
- Проверить холодный/обычный возврат каждого OAuth-провайдера через системный браузер.
- Проверить удаление аккаунта; Apple grant должен быть отозван перед удалением данных.
- Настроить подтверждение email и восстановление аккаунта перед широким публичным выпуском.
- Завершить собственную политику конфиденциальности и поддержку, заполнить сведения о данных и материалы магазина.
- Убедиться, что окончательная сборка использует правильный сервер и доступна из мобильной сети, а не только с Wi‑Fi компьютера.

Подписанная IPA, TestFlight и доступность iPad-приложения на Apple silicon Mac пока не проверены. Microsoft Store и отдельная сборка для Intel Mac остаются последующими этапами.
