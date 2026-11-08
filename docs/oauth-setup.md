# Google, Apple и Microsoft — настройка входа

Кнопки входа не создают аккаунты у провайдеров и не заменяют регистрацию OAuth-приложения. Пока серверные параметры не заполнены, соответствующий вход недоступен; гостевой вход остаётся доступен. Секреты задаются только на сервере, без префикса `VITE_`.

## Общая схема

1. Клиент генерирует случайный `codeVerifier` из 32 криптографически случайных байтов, кодирует его в base64url без padding и сохраняет локально до возврата. В `POST /api/auth/{provider}/start` отправляется `{ "codeChallenge": "<base64url(SHA-256(codeVerifier))>", "returnTo": "..." }`. Bearer текущего гостя передаётся только при привязке провайдера к этому профилю; для обычного входа он не нужен.
2. API возвращает `{ "url": "..." }`. Для браузера откройте этот URL обычной навигацией; на телефоне используйте системный браузер, а не встроенную страницу провайдера в WebView.
3. Провайдер возвращает пользователя на `<PUBLIC_URL>/api/auth/{provider}/callback`. Google и Microsoft используют GET, Apple — POST.
4. После проверки сервер возвращает пользователя на разрешённый адрес с фрагментом `#auth_code=<одноразовый код>`.
5. Клиент извлекает код, отправляет `POST /api/auth/exchange` с `{ "code": "...", "codeVerifier": "<сохранённый verifier>" }`, получает `{ "token", "user" }` и удаляет код из адресной строки и временный verifier из локального хранилища. Обмен доступен один раз и только для клиента, который сохранил verifier.

`provider` — `google`, `apple` или `microsoft`. Список статусов доступен через `GET /api/auth/providers`: `{ id, configured }[]`. Статус `configured` означает наличие настроек, а не успешную внешнюю проверку credentials.

`PUBLIC_URL` — корень API. `CLIENT_URL` — точный URL возврата веб-клиента, в локальной конфигурации `http://127.0.0.1:5173`. `NATIVE_REDIRECT_URL` по умолчанию равен `space.opencalendar.app://auth`. Произвольные адреса возврата не разрешены. В production используйте HTTPS для API и веб-клиента.

Текущий гостевой bearer связывает вход с текущим профилем согласно серверной реализации. Проверьте сценарий существующего аккаунта, привязки и выхода: нельзя автоматически объединять профили только по совпавшему имени или непроверенному email.

## Google

Создайте проект и OAuth-клиент в Google Cloud, настройте экран согласия и тестовых пользователей. Для реализованного серверного потока зарегистрируйте web application и точный redirect URI:

```text
https://<ваш-api-домен>/api/auth/google/callback
```

Задайте `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` на API. Используется вход в аккаунт; доступ к Google Calendar не запрашивается автоматически. Это приложение не синхронизирует личный Google Calendar. Для отдельной нативной реализации Google рекомендует Android Credential Manager; если вы заменяете серверный поток на нативный, нужны отдельные platform client IDs и проверка токенов на сервере. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

## Apple

В Apple Developer настройте App ID с Sign in with Apple, Services ID для серверного входа, домен и Return URL:

```text
https://<ваш-api-домен>/api/auth/apple/callback
```

Задайте `APPLE_CLIENT_ID` как Services ID, а также `APPLE_TEAM_ID`, `APPLE_KEY_ID` и `APPLE_PRIVATE_KEY` из скачанного `.p8`. Ключ PEM допускает экранированные переносы `\n` в значении окружения. Backend подписывает client secret через ES256. Не помещайте `.p8` в приложение, архив исходников или клиентские переменные. Проверьте relay email и сценарий, когда Apple предоставляет имя только при первом согласии. [Настройка Sign in with Apple](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple)

Для сохранения Apple grant на сервере задайте стабильный случайный `TOKEN_ENCRYPTION_KEY` длиной от 32 символов. Он используется для AES-256-GCM; при его отсутствии ключ выводится из `APPLE_PRIVATE_KEY`, поэтому ротация Apple-ключа без миграции может сделать сохранённые grant недоступными. Google/Microsoft access и refresh tokens сервер не сохраняет.

Backend отзывает сохранённый Apple grant при удалении аккаунта. Если Apple недоступна, API возвращает `provider_revocation_failed` и сохраняет аккаунт для повторной попытки. До App Store-релиза проверьте Sign in with Apple на устройстве и удаление с настоящим аккаунтом. [Удаление аккаунта Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)

## Microsoft

Создайте App registration в Microsoft Entra. Для аудитории с личными Microsoft-аккаунтами выберите account type, включающий personal accounts. Зарегистрируйте Web redirect URI:

```text
https://<ваш-api-домен>/api/auth/microsoft/callback
```

Задайте `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` и `MICROSOFT_TENANT_ID`. Значение tenant по умолчанию — `common`; оно не расширяет audience зарегистрированного приложения само по себе. Для приложения одной организации задайте её tenant ID и соответствующий account type. Следите за истечением client secret. [Регистрация Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

## Возврат на телефон

В сгенерированных оболочках уже зарегистрирован адрес `space.opencalendar.app://auth`: Android `intent-filter` с `VIEW`, `DEFAULT`, `BROWSABLE`, iOS URL Type с scheme `space.opencalendar.app`. Клиент должен обрабатывать `appUrlOpen` через Capacitor App, закрывать системный браузер и выполнять одноразовый обмен. Само наличие manifest-записей не заменяет проверку возврата на устройстве.

Обмен одноразового кода связан с исходным клиентом через отдельный app-level PKCE: перехваченного callback-кода без сохранённого verifier недостаточно для входа. Это отдельная проверка от PKCE между сервером и Google/Microsoft. Для production-домена также можно настроить verified App Links / Universal Links вместо custom scheme.

`codeChallenge` должен состоять из 43 base64url-символов; `codeVerifier` — из 43–128 символов RFC 7636. Неверный или отсутствующий challenge возвращает `invalid_code_challenge`, неверный verifier — `invalid_exchange_verifier`. Проверьте возврат при холодном старте приложения, при открытом приложении, отмену входа, ошибку провайдера, потерю verifier, повторное использование кода и истёкший код на настоящих iPhone и Android. Не считайте веб-тест достаточным подтверждением мобильного входа.
