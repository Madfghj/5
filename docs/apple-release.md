# OpenCalendar: подготовка iPhone, iPad и Mac

Проверено 8 ноября 2026 года. Исходный проект содержит оболочку Capacitor для iPhone/iPad, Bundle ID `space.opencalendar.app`, Swift Package Manager, четыре языка, иконку, OAuth URL scheme и ручные workflows. На текущем Windows-ПК Xcode не запускался: подписанная IPA, установка на iPhone и запуск на Mac не подтверждены. Этот документ описывает подготовку, а не опубликованный App Store-релиз.

## Первый выпуск для MacBook

Для конкретных Intel MacBook 2016 и Mac под macOS Monterey этот маршрут не подходит. Им подготовлен отдельный [desktop target](macos-build.md) с minimum macOS 12.0 и Intel/Apple silicon архитектурами. Статус его компиляции и подписи проверяется отдельно; iPad-сборка не выдаётся за Intel-приложение.

Совместимое iPhone/iPad-приложение можно предложить в Mac App Store для Mac с Apple silicon в режиме «Designed for iPad». Оно использует ту же iOS-сборку, без отдельного macOS-порта. В App Store Connect доступность управляется в **Pricing and Availability → iPhone and iPad Apps on Apple Silicon Mac**. Apple вычисляет минимальную совместимую macOS по сборке; при необходимости её можно повысить в этом разделе. Не следует обещать конкретную минимальную macOS до обработки реальной сборки. [Настройка доступности Apple](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-of-iphone-and-ipad-apps-on-macs-with-apple-silicon).

Этот путь подходит Apple silicon MacBook. Intel Mac не запускает iOS-приложения этим способом. Для Intel и отдельного macOS-интерфейса нужен самостоятельный Mac build, например Mac Catalyst, с проверкой Capacitor/плагинов, адаптацией UI и собственной подписью/архивом. Один флаг поддержки Mac не доказывает, что зависимости соберутся. [Конфигурация Mac Catalyst](https://developer.apple.com/tutorials/mac-catalyst/turning-on-mac-catalyst).

Mac Catalyst может использовать тот же Bundle ID и universal purchase. Выпуск macOS-платформы в той же карточке заменит iOS-приложение, предлагаемое на Mac; планировать этот переход нужно до отправки. Сейчас macOS-платформа и Catalyst target не созданы. [Платформы App Store Connect](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms/).

## Что уже подготовлено в исходниках

- Target поддерживает iPhone и iPad (`TARGETED_DEVICE_FAMILY = 1,2`), deployment target iOS 15+.
- `Info.plist` объявляет arm64 без требований к камере, телефонии или GPS. Базовый native-язык — English; доступны English, Русский, Deutsch и Français. Первый экран приложения остаётся английским, затем предлагается выбор языка.
- Иконка — собственный непрозрачный RGB PNG 1024 × 1024 в универсальном iOS asset catalog.
- Возврат OAuth — `space.opencalendar.app://auth`; интерфейс включён в приложение, API берётся из публичного HTTPS origin в `mobile.config.json`.
- `scripts/ci-native-check.mjs ios` проверяет эти файлы после `build:mobile` и `cap sync ios`. Он не проверяет подпись, регистрацию идентификатора у Apple или фактический запуск.
- Ручной `Mobile test builds` подготавливает unsigned iOS Simulator `.app`; `Mobile signed archives` — App Store IPA при наличии секретов. Никакой из workflows не отправляет приложение в магазин. Они пока не проходили на macOS runner. Подробности — в [mobile-ci.md](mobile-ci.md).

Требование arm64 соответствует актуальному описанию `UIRequiredDeviceCapabilities` для 64-битного приложения. [Ключ capabilities](https://developer.apple.com/documentation/BundleResources/Information-Property-List/UIRequiredDeviceCapabilities).

## Входные данные владельца

| Что требуется | Для чего |
| --- | --- |
| Действующее членство Apple Developer Program и доступ к App Store Connect | Регистрация, сертификаты и публикация. Обычный Apple Account сам по себе не заменяет членство. |
| Окончательные имя приложения, Bundle ID и право на название | Зарегистрировать App ID и карточку, не менять идентификатор после релиза. |
| Mac с Xcode либо разрешённый macOS CI runner и репозиторий владельца | Реальная компиляция и архив. Сначала проверить доступность runner и расход allowance. |
| Apple Team ID, Distribution `.p12` с паролем и App Store provisioning profile | Подписать текущий IPA workflow. Хранить только в защищённых секретах, не в Git/архиве исходников. |
| Действующие контакты разработчика и поддержки, публичная политика конфиденциальности | Заполнить карточку и доступную ссылку внутри приложения. Не подставлять вымышленные данные. |
| Данные для App Privacy, возрастного рейтинга, export compliance и ревью | Заполнить по реальному приложению и работающим сервисам. |

Apple проверяет сведения владельца при [регистрации](https://developer.apple.com/programs/enroll/). Здесь не оформлялись членство, оплата, соглашения или новые сертификаты. Реквизиты не следует отправлять в чат: они вводятся на официальных страницах владельцем.

Готовые тексты на четырёх языках уже находятся в [store-listing.md](store-listing.md); не нужно создавать другую противоречащую карточку. [privacy-template.ru.md](privacy-template.ru.md) остаётся незавершённым черновиком с полями владельца. Пока не задан и не проверен публичный URL политики, этот черновик нельзя выдавать за опубликованную политику. [Требования App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).

## Порядок сборки и проверки

1. Собрать web/mobile assets, синхронизировать iOS и выполнить preflight. Зафиксировать точную версию/номер сборки и origin API.
2. На Mac/runner с Xcode 26+ и SDK iOS/iPadOS 26+ разрешить SPM dependencies и скомпилировать Simulator `.app`. Запустить его на iPhone и iPad simulators; одна компиляция без запуска не проверяет интерфейс. [Минимальные SDK Apple с 28 апреля 2026 года](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).
3. После регистрации App ID/карточки и установки подписи создать Release Archive для iOS, проверить его и экспортировать App Store IPA. Simulator `.app` не устанавливается на физический iPhone и не является IPA.
4. Загрузить build в App Store Connect через Xcode/Transporter или отдельно настроенный официальный upload flow, дождаться обработки. Существующий workflow только сохраняет IPA, поэтому upload — отдельный шаг. [Загрузка сборок Apple](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).
5. Через TestFlight проверить физические iPhone и iPad. В tester group включить тестирование iPhone/iPad build на Apple silicon Mac и проверить его на MacBook; не отмечать **Verify Compatibility** по результатам одного браузерного скриншота. [Проверка iOS build на Mac через TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/test-iphone-and-ipad-apps-on-macs-with-apple-silicon).
6. Подготовить настоящие скриншоты, review instructions/доступ для проверки и законченные сведения карточки. После выполнения QA отправить build на App Review, а затем проверить реальную доступность магазина. Успешная загрузка или TestFlight не означает одобрение App Store.

## Обязательная фактическая QA перед отправкой

- Чистая установка: английский экран, выбор каждого из четырёх языков, регистрация; возвращение после перезапуска сохраняет аккаунт, язык и группы.
- iPhone/iPad: portrait/landscape, safe areas, экранная клавиатура, увеличенный текст, список языков, формы и даты без обрезки.
- Создание группы, вступление по приглашению, выбор любой даты, «Да / Нет / Пока не знаю», время 08:00–20:00 и заметка; второй участник видит имя и обновление.
- Все объявленные способы входа: реальный consent, callback, обычный и холодный возврат в приложение, отмена и повторный вход без дубликата аккаунта. Не рекламировать ненастроенный провайдер как рабочий.
- Presence: активный режим, уход в фон/закрытие, ручной DND; проверить поведение сна/пробуждения Mac.
- MacBook: мышь, trackpad, клавиатура/Tab/Escape, изменение окна, меню «Поделиться», системный браузер и возвращение OAuth; повторить после завершения процесса.
- Физическая мобильная сеть и Wi‑Fi: приложение обращается к облаку и не зависит от включённого Windows-ПК.
- Удаление аккаунта и обработка связанных групп; при подключённом Apple — реальный отзыв Apple grant. Проверить доступные способы восстановления: подтверждение email и отправка писем восстановления пока не настроены.

В таблице результатов фиксировать модель/ОС, версию приложения, сценарий, результат и обнаруженные ограничения. Пока этих результатов нет, статус iPhone/Mac — **подготовлен проект, проверка на устройствах ожидается**.
