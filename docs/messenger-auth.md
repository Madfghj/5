# Telegram, WhatsApp и Signal

Сверено 7 ноября 2026 года. Это руководство по интеграции, а не подтверждение регистрации приложения у провайдеров или успешного входа с настоящими аккаунтами.

| Сервис | Подходящий способ для OpenCalendar |
| --- | --- |
| Telegram | Официальный OIDC-вход после настройки приложения в BotFather. |
| WhatsApp | Необязательная контактная ссылка или отдельный будущий OTP-проект через Business API. |
| Signal | Необязательная контактная ссылка; документированный внешний SSO в проверенных официальных материалах не найден. |

## Telegram

Актуальный Telegram Login поддерживает Authorization Code Flow с PKCE. Старый iframe-виджет архивирован. В BotFather нужно выбрать бота, открыть Login Widget, добавить разрешённый HTTPS callback и получить Client ID / Client Secret. Для календаря достаточно `openid profile`; номер телефона и разрешение писать сообщения не запрашиваются. [Telegram Login](https://core.telegram.org/bots/telegram-login)

| Настройка | Значение |
| --- | --- |
| Discovery | `https://oauth.telegram.org/.well-known/openid-configuration` |
| Authorization | `https://oauth.telegram.org/auth` |
| Token | `https://oauth.telegram.org/token` |
| JWKS | `https://oauth.telegram.org/.well-known/jwks.json` |
| Issuer | `https://oauth.telegram.org` |
| Серверные переменные | `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET` |
| Callback проекта | `<PUBLIC_URL>/api/auth/telegram/callback` |

Код обменивает сервер: HTTP Basic с Client ID/Secret и PKCE verifier. Профиль берётся из проверенного ID token; отдельного UserInfo endpoint нет. Проверяются подпись, issuer, audience, expiration, state и запрошенный nonce. Идентичность хранится по `iss + sub`: изменяемый `preferred_username` служит только для отображения. Email среди описанных Telegram claims отсутствует. [Поток и токены](https://core.telegram.org/bots/telegram-login)

Client Secret не является Bot API token и не помещается в приложение. Кнопка остаётся недоступной, пока credentials не настроены. Настоящий вход и возврат в мобильное приложение проверяются отдельно на устройствах.

## WhatsApp

Официальный пример показывает доставку собственных одноразовых кодов через WhatsApp Business API. Это не такой же общий OIDC-вход, как Telegram. Требуются отдельная business-настройка и серверная проверка OTP; успешная отправка сообщения сама по себе не подтверждает пользователя. [Официальный OTP-пример WhatsApp](https://github.com/WhatsApp/WhatsApp-OTP-Sample-App/blob/main/README.md)

В текущем объёме пользователь может указать контактную ссылку `https://wa.me/...` или отправить приглашение обычным меню «Поделиться». Ссылка не доказывает владение аккаунтом и не используется для восстановления входа. Будущий OTP-вход потребует отдельной настройки владельцем, шаблонов, сроков действия кодов и ограничений попыток. Не запрашивайте пароль WhatsApp или его регистрационный код в OpenCalendar.

## Signal

В проверенном developer-разделе описаны протоколы и библиотеки Signal; внешний OAuth/OIDC-вход для стороннего календаря там не найден. Это вывод по доступной документации, а не утверждение, что такая возможность никогда не появится. [Документация Signal](https://signal.org/docs/)

Пользователь может скопировать собственную ссылку из Signal → профиль → QR Code or Link. Уникальный URL не содержит текст username, поэтому его нельзя надёжно построить из имени. [Ссылки и usernames Signal](https://support.signal.org/hc/en-us/articles/6712070553754-Phone-Number-Privacy-and-Usernames)

OpenCalendar хранит такую ссылку как неподтверждённый контакт. Signal PIN, registration code и recovery key не запрашиваются.

## Проверки в OpenCalendar

- Для ссылок разрешаются только HTTPS и точные хосты `t.me` / `telegram.me`, `wa.me`, `signal.me`. URL с логином или паролем отклоняется; важный fragment ссылки Signal сохраняется.
- Ответы на встречи привязаны к внутреннему user ID. Участники видят имя профиля, а не email, пароль или bearer-токен.
- Подключение провайдера выполняется из авторизованной сессии; аккаунты не объединяются автоматически по email или имени.
- Новый запуск начинается на английском: выбор из четырёх языков, затем регистрация. Email-регистрация этого этапа не объявляет адрес подтверждённым без отправки и проверки письма.
- Работа при выключенном компьютере требует опубликованных облачного API и базы. Messenger credentials не заменяют развёртывание; его порядок описан в [online-deployment.md](online-deployment.md).