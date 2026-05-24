# PITCHUP — Спека: глобальные решения

> Часть спеки. Карта всех файлов — [INDEX](./pitchup-spec-INDEX.md).
> ⚠ **После правки этого файла** — пройди audit-checklist в шапке [pitchup-app-map.md](./pitchup-app-map.md) и синхронно обнови карту, если затронуты пункты чек-листа (стек, нав, TopBar, login, PWA, cron, lifecycle, сущности).
> Здесь: общие правила (auth, данные, модель матча, уведомления, real-time, бан), карта сайта, entry-страницы (`/`, `/login`, `/welcome`), глобальные компоненты, error/empty pages, legal.

---

## Глобальные решения

### Аутентификация
- **Только Google OAuth** (Auth.js v5). Никаких email/пароля на старте.
- После первого входа → онбординг `/welcome`.
- **JWT lifetime: 333 дня** (Auth.js v5 `session.maxAge = 333 * 24 * 60 * 60`). Refresh JWT не делаем — почти год держится подавляющее большинство сессий, юзер за это время не уходит. Браузерный hard cap на cookie — 400 дней (Chrome, с 2022), 333 укладывается с запасом. Принудительная инвалидация при ban / delete-account уже решена через `revoked_sessions` (см. следующий пункт) — долгий lifetime безопасности не вредит. Кнопка "Sign out everywhere" (массовый insert в `revoked_sessions` для всех `jti` юзера) — кандидат на v1.1, в MVP нет.
- **Session invalidation через `revoked_sessions`.** Auth.js v5 в strategy=`jwt` хранит сессию в подписанной cookie на клиенте — серверного store нет, "удалить session row" невозможно. Чтобы ban / delete-account отрезали юзера от существующих токенов без ожидания их естественного истечения, заводим серверную таблицу `revoked_sessions(jti TEXT PRIMARY KEY, user_id UUID NOT NULL, revoked_at TIMESTAMPTZ NOT NULL DEFAULT now())`. При каждом sign-in в JWT добавляется уникальный `jti` claim (см. таблицу JWT claims ниже). На каждый mutating endpoint (`POST`/`PATCH`/`DELETE` под `/api/*`, кроме `/api/auth/*`) и на каждый heartbeat SSE-каналов (`/api/updates/stream`, `/api/matches/:id/stream`) backend проверяет `NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE jti = ?)`. При ban или delete-account — `INSERT INTO revoked_sessions(jti, user_id) VALUES (?, ?)` для **всех известных `jti` юзера** в той же транзакции (см. "Бан / удаление аккаунта" ниже). Любая последующая операция или heartbeat по этому токену отдаёт `401`. Cron-чистка `revoked_sessions` (TTL = 334 дня = JWT lifetime 333 + 1 день запаса) — часть **Inbox TTL cleanup** (ежедневно 03:00 Prague), см. "Cron-задачи" в [match.md](./pitchup-spec-match.md).

### Данные пользователя
| Поле | Источник | Обязательно | Видимость |
|---|---|---|---|
| Имя | Google (редактируемо) | Да | Публично |
| Аватар | Google (редактируемо) | Нет | Публично |
| Contact info | Вводит сам, свободный текст | Нет | Публично |
| Email | Google | Да | Только для нотификаций, не показываем |
| Email notifications | Пользователь (toggle в /me, default on) | Нет | Только аккаунтный параметр — не публично |

> **Принцип:** всё что игрок заполняет в профиле — публично. Хочешь приватнее — не заполняй. Email — единственное приватное поле, нужен только для нотификаций.
> `email_notifications` — единственный non-public параметр помимо email. Управляет отправкой approve/kick/morning-reminder писем. Default: on.

> **Contact info** — одно свободное текстовое поле "How to reach me" (placeholder: "WhatsApp +420..., Telegram @username, Instagram..."). Игрок сам решает что писать и стоит ли вообще. Если не заполнено — поле просто не показывается в профиле.
> Редактируется в модалке `Edit profile` на `/me` — рядом с именем (одно место для всех публичных полей профиля, никакой фрагментации).

### Уникальный логин / username
**Нет.** Только имя + аватар. Внутри системы — UUID.

### Повторный вход
Если в БД уже есть `users` строка для этого `google_sub` — онбординг завершён, юзер сразу попадает на `/my-matches`. Если строки нет — middleware редиректит на `/welcome` (см. "Guard онбординга" ниже).

### Guard онбординга (middleware)

**Один источник правды — БД.** Middleware на каждый защищённый request делает один SELECT по индексу `google_sub`: есть user row → онбординг завершён → пропускаем; нет row → юзер ещё не онбордился → редирект на `/welcome`. Никакого JWT-claim для `onboarding_completed`, никакого Auth.js `update()`, никакой shell-row.

Залогиненный юзер **без user row в БД** принудительно редиректится на `/welcome` при попытке открыть любую страницу, кроме разрешённых ниже. Это закрывает кейсы: deep-link `/matches/:id` сразу после OAuth, ручной ввод URL `/my-matches`, букмарк `/me`.

**Разрешено без редиректа** (чтобы не было loop'а и чтобы юридические страницы были доступны всегда):
- `/welcome` — сам онбординг
- `/legal/terms`, `/legal/privacy` — legal must быть доступен
- `/api/auth/*` — Auth.js callbacks (sign-out и т.д.)

**Всё остальное** (`/my-matches`, `/games`, `/map`, `/chats`, `/matches/*`, `/me`, `/users/*`, `/admin/*`) → `/welcome`. **CallbackUrl сохраняется через онбординг:** middleware при редиректе на `/welcome` прокидывает оригинальный путь в query (`/welcome?callbackUrl=/matches/abc123`) — имя параметра `callbackUrl` (родное для Auth.js v5), один и тот же ключ по всему flow (не путать с `next`, который мы нигде не используем). После завершения онбординга → если есть валидный `callbackUrl` (same-origin, прошёл Auth.js валидацию) → редирект туда. Иначе `/my-matches`. Это закрывает кейс "гость кликнул Join на матче, прошёл OAuth + онбординг — вернулся на тот же матч уже залогиненным".

Edge case: `next` ведёт на закрытую страницу не подходящую для нового юзера (`/admin/*` — у новичка `is_admin=false`) → стандартная middleware-проверка после онбординга развернёт на `/my-matches`. Никакой специальной логики не нужно.

**Гость (нет сессии) на `/welcome`** → редирект на `/login` (без callbackUrl — стандартный вход). После OAuth:
- Новый юзер (нет user row) → middleware видит отсутствие row → `/welcome`
- Старый юзер (есть user row) → middleware пропускает → `/my-matches`

**Реализация.** Next.js middleware: проверяет наличие сессии в JWT (см. набор claim'ов ниже), затем — наличие user row в БД. Три ветки:
1. Нет сессии + путь `/welcome` → `/login`
2. Есть сессия + нет user row в БД + путь не в allowlist → `/welcome?callbackUrl=<path>`
3. Есть сессия + есть user row + путь `/welcome` → `/my-matches`

**Что лежит в JWT — через явный `jwt` callback.** Custom claims, которые мы кладём в токен и пробрасываем в `session` callback'ом:

| Claim | Источник | Зачем |
|---|---|---|
| `googleSub` | `account.providerAccountId` на первом sign-in (`provider === 'google'`) | Стабильный OAuth-identifier для middleware-lookup'а user row в БД. На `token.sub` не полагаемся — это internal id Auth.js, семантика может измениться между версиями. |
| `email` | `profile.email` | Используется в `/welcome` INSERT (см. ниже) и в email-нотификациях. |
| `name` | `profile.name` | Pre-fill имени на `/welcome` (в т.ч. при reload вкладки без повторного OAuth). После онбординга — для UI, пока user row ещё не подтянулась. |
| `picture` | `profile.picture` | Pre-fill аватара на `/welcome`, аналогично `name`. |
| `jti` | Генерится сервером при каждом sign-in (`crypto.randomUUID()`) | Уникальный идентификатор токена. Используется для проверки против `revoked_sessions` на mutating endpoints и SSE heartbeat (см. "Аутентификация" выше). При ban/delete-account `jti` инсертится в `revoked_sessions`, все последующие операции по этому токену отдают `401`. |

Auth.js пробрасывает их в `session` callback'е как `session.googleSub`, `session.user.name`, `session.user.image`, `session.user.email`. Middleware читает `session.googleSub`. Pre-fill на `/welcome` reload — `session.user.name` / `session.user.image` (см. "Reload state" в `/welcome` ниже).

> **`is_admin` не в JWT.** Флаг `is_admin` намеренно **не кладётся в токен** — всегда читается из БД по `user_id` (внутри `requireAdmin()` guard'а на admin endpoints и при рендере админских страниц). Это сознательно: promote/demote/ban срабатывают **без повторного логина** — в момент INSERT/UPDATE по `users.is_admin` следующий же запрос видит новое значение. Если бы `is_admin` лежал в JWT — пришлось бы либо ждать истечения токена, либо изобретать дополнительный канал инвалидации помимо `revoked_sessions`.

> **Когда подключим второй провайдер** (например, login by email/password или Apple) — `googleSub` останется только для Google-юзеров, для остальных будет аналогичный per-provider claim (`appleSub`, и т.п.) или общий `providerId` + `provider`. Лукапа user row пойдёт по композитному ключу `(provider, providerId)`. В v1 (только Google) — упрощено до `googleSub`. См. "Что НЕ делаем в v1" в [personal.md](./pitchup-spec-personal.md) → "Дополнительные OAuth-провайдеры".

DB-адаптер (`@auth/prisma-adapter`) **не используется** — он бы инсертил user row на OAuth callback, до `/welcome`, что ломает "user row создаётся только при `[Get started →]`" ниже.

**Стоимость лишнего SELECT.** Один SELECT по primary-key индексу на каждый защищённый request. На Neon с pooler — 0.5-2ms. На запрос который и так делает SSR + Tailwind + React-рендеринг — незаметно. Раньше держали `onboarding_completed` в JWT claim ради этой экономии, но цена была 3 точки рассинхрона (БД ↔ JWT ↔ клиентская session через `Auth.js update()`) и потенциальные redirect-loop'ы. Перешли на "один источник = БД".

**User row создаётся только при завершении онбординга** (тап `[Get started →]` на `/welcome`) — INSERT с `google_sub`, `email`, `name`, `avatar_url`, `contact_info=NULL`. Никакого `onboarding_completed` флага, никакой shell-row при OAuth — пока юзер не дошёл до конца, в БД его нет.

**Google profile — snapshot, не sync.** `name`, `avatar_url`, `email` снапшотятся в `users` row **в момент онбординга** и больше **не синхронизируются с Google**. Если юзер сменил аватар / имя / email в Google-аккаунте после онбординга — в PITCHUP останется старое значение. Обоснование:
- `name` — на `/welcome` редактируемое, в `/me → Edit profile` тоже. Авто-перезапись с Google затёрла бы юзерские правки. Юзер сам контролирует имя.
- `avatar_url` — в v1 редактирования аватара в UI нет (см. "Что НЕ делаем в v1" в [personal.md](./pitchup-spec-personal.md) — нет файл-хранилища), но и авто-апдейта с Google тоже нет. Самое предсказуемое поведение: что юзер увидел на онбординге — то и осталось.
- `email` — используется только для нотификаций. Снапшот в момент онбординга. Если юзер сменил Google-email, нотификации продолжают идти на старый. Это известный пробел (см. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md) — UI-ручки сменить email в v1 нет). Когда добавим — будет в `/me → Edit profile` рядом с именем.

JWT claims (`googleSub`, `email`, `name`, `picture` — см. "Что лежит в JWT" выше) продолжают подтягиваться из свежего OAuth payload на каждом sign-in — они нужны для `/welcome` reload pre-fill у юзеров без user row, не для апдейта существующих row. Middleware-lookup идёт по `googleSub`, остальные claim'ы для существующего юзера не используются.

**Следствия:**
- **Дроп с онбординга** (закрыл вкладку): user row не создан → при следующем OAuth middleware снова редиректит на `/welcome`. Pre-fill имени/аватара берётся **из Google OAuth payload** (`session.user.name`, `session.user.image`), не из БД. Полностью equivalent — Google всегда возвращает эти поля.
- **Sign-out с `/welcome`**: стандартный Auth.js sign-out, никакого DELETE — нечего удалять. При следующем входе — снова `/welcome` с теми же pre-filled данными из Google.
- **Cron-чистка "брошенных" аккаунтов не нужна** — нет shell-row'ов которые копятся.

### Доступ гостя (не залогинен)

**Доступно без логина (read-only):**
| Страница | Что видит гость |
|---|---|
| `/` | Лендинг полностью |
| `/login` | Кнопка Google OAuth |
| `/legal/terms`, `/legal/privacy` | Статика |
| `/games` | Список матчей. Все фильтры работают. Карточки кликабельны → `/matches/:id` |
| `/map` | Карта матчей с пинами. Те же фильтры что на `/games` (синхронизированы через URL). Тап на пин → bottom-sheet с MatchCard |
| `/matches/:id` | Полная страница: cover, детали, Lineup (видны все игроки), Chat (только чтение). CTA bar заменён на disabled `[Sign in to join]` |
| `/users/:id` | Публичный профиль любого игрока (имя, аватар, contact info) |

**Закрыто для гостя — редирект на `/login`:**
- `/my-matches`, `/chats`, `/me` — личные страницы
- `/matches/new`, `/matches/:id/edit` — действия требуют авторства
- `/admin/*` — кроме прочего, ещё и `is_admin` check (`requireAdmin()`)
- Любой POST/DELETE (Join, Leave, Like, Report, Chat send) — backend отвечает 401, frontend перехватывает → `/login`

**Возврат после логина:**
- При редиректе на `/login` сохраняется `?callbackUrl=<исходный путь>` в query — стандартный параметр Auth.js v5, валидация same-origin и редирект после OAuth встроены.
- После успешного OAuth:
  - **Юзер уже прошёл онбординг** (есть user row в БД) → стандартный Auth.js редирект на `callbackUrl`. Если callbackUrl пустой → `/my-matches`.
  - **Юзер новый** (нет user row в БД) → middleware перехватывает любую попытку открыть что-то кроме `/welcome` и редиректит на `/welcome?callbackUrl=<callbackUrl>`. После завершения онбординга → редирект на `callbackUrl` если валиден, иначе `/my-matches`. Подробнее — в "Guard онбординга".
- Пример 1 (существующий юзер): гость на `/matches/abc123` жмёт `[Sign in to join]` → `/login?callbackUrl=/matches/abc123` → Google → `/matches/abc123` уже как залогиненный с активной кнопкой Join.
- Пример 2 (новый юзер): то же самое → Google → middleware: user row отсутствует → `/welcome?callbackUrl=/matches/abc123` → онбординг → редирект на `/matches/abc123`.

**Визуальные отличия для гостя:**
- **TopBar** — лого слева, кнопка `[Sign in]` справа (вместо 🔔). См. "TopBar (guest)" ниже.
- **BottomNav** — показывается с теми же 5 табами что и для залогиненного, но `My matches`, `Chats`, `Me` disabled (тап → `/login?callbackUrl=<этот таб>`). Лого в TopBar ведёт на `/games`.
- **На `/matches/:id`** — CTA bar внизу всегда disabled `[Sign in to join]` (вместо Join / Notify me / You're in). Tab Chat: инпут заменён на ghost-блок `[Sign in to chat]`. В `[⋯]` меню — только `Share` (Report match скрыт). Share работает без логина — публичная ссылка.
- **На `/users/:id`** — `[Report player]` в `[⋯]` меню **виден для гостя** (не прячем UI); тап → Sign-in modal (`"Sign in to report this player"`). После логина юзер возвращается на страницу и жмёт Report сам.
- **На `/games` и `/map`** — кнопка `[+ New match]` в top bar показана, тап → `/login?callbackUrl=/matches/new`.

**Триггеры авторизации (где гость сталкивается с логином):**

Два разных пути — **modal** для inline-действий и **редирект на `/login`** для прямых переходов на закрытые страницы.

**Sign-in modal** (единый компонент, используется везде):
- Заголовок зависит от контекста: "Sign in to join this match", "Sign in to chat", "Sign in to report", "Sign in to track your matches" и т.д.
- Подзаголовок: "We only use Google. No passwords, takes 5 seconds."
- Кнопка `[Continue with Google]` primary (full-width)
- Кнопка `[Cancel]` ghost (или крестик в углу). Тап вне модалки = cancel.
- После успешного OAuth — возврат на ту же страницу, **действие НЕ авто-выполняется** (юзер сам жмёт Join / Send / Report после возврата). Это намеренно — даём ему пересмотреть, не делаем неожиданных действий.
- Технически OAuth-flow тот же `/api/auth/signin/google?callbackUrl=<current_url>`, просто entry-point — модалка а не отдельная страница.

**Где модалка** (любое inline-действие гостя):
- Любая `[Sign in to ...]` кнопка в CTA bar / Chat-инпуте / Topbar
- Тап на Join-пин на карте / Join-кнопку из bottom-sheet превью
- `[Report player]` на `/users/:id` — тап гостя открывает Sign-in modal (кнопка видна; подробнее — "Визуальные отличия для гостя" выше). `[Report match]` на `/matches/:id` — **скрыт** для гостя (в `[⋯]` остаётся только `Share`).
- BottomNav: тап гостя на disabled-таб `My matches`, `Chats` или `Me` → `/login?callbackUrl=<этот таб>`

**Где редирект на `/login?callbackUrl=...`** (deep-link / прямой URL):
- Букмарк `/me`, `/my-matches`, `/chats`, `/matches/new`, `/admin/*` → `/login?callbackUrl=<тот же URL>`
- Backend 401 на прямом fetch (юзер потерял сессию посреди работы) → клиент редиректит на `/login?callbackUrl=<current>`

### Viewport — только mobile-design
**Отдельной desktop-версии в v1 нет.** Весь UI рисуем под mobile (target ~390-414px), на больших экранах — тот же layout, отцентрированный в контейнере `max-width: 480px`. По бокам — пустое пространство (можно залить нейтральным фоном / иллюстрацией).

**Что это значит на практике:**
- Никаких desktop-only элементов: top-nav со ссылками, sidebar на `/games` или `/admin`, 2-column layout на `/my-matches`. Всё это **выпадает** из спеки — игнорируйте упоминания "Desktop:" в разделах ниже как устаревшие.
- BottomNav и TopBar **всегда** sticky внутри центрального 480px-контейнера (на любом размере экрана). Это не "desktop-специфик", а одно правило: всё липнет к границам контейнера. На больших экранах вокруг контейнера — нейтральный фон.
- TopBar один и тот же на любом размере экрана.
- Админка — тоже scaled mobile. Таблицы на 480px помещаются за счёт horizontal scroll в самой таблице (overflow-x: auto). Для admin это компромисс — мы знаем, что админ обычно сидит за десктопом, но в v1 не дублируем layout ради 1-2 юзеров с правами.

**Почему так:** игроки заходят с телефона (это pickup football, не enterprise tool). Desktop-версия для v1 — это удвоение работы ради нишевого юзкейса. Когда появится спрос — добавим адаптивные breakpoint'ы как известный пробел (см. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md)).

### Язык UI и i18n

**Все UI-строки в спеке — EN-only.** Это касается лейблов, кнопок, плейсхолдеров, toast'ов, заголовков error/empty-страниц, email-шаблонов, текстов notification.body. Любые цитаты вида `"Sign in to join this match"`, `"This user is no longer on PITCHUP."`, `"Not enough spots — increase Total or reject"` — финальные английские строки, не placeholder'ы для перевода.

**В коде `next-intl` заложен с первого дня** — все строки оборачиваем в ключи (`t('match.signInToJoin')` и т.п.), даже если на старте есть только английский namespace. Это избавляет от рефакторинга при добавлении CZ — нужно только подложить второй translations-файл.

**Перевод на CZ — v1.1+**, не в MVP. Чешский namespace создаётся отдельным релизом, переключатель языка в `/me` появляется тогда же. До этого момента `next-intl` отдаёт только `en` локаль, без UI-выбора. См. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md).

### Форматы матчей
**Свободный ввод количества игроков.** Капитан задаёт только Total spots. Валюта цены — только Kč (фиксировано).

### Покрытие поля (для фильтров и карточки матча)

**Два варианта покрытия:** `Grass` (любая трава — natural или artificial turf) и `Hard surface` (любое жёсткое — паркет, бетон, asphalt, indoor зал). Принципиальное отличие — можно ли играть в шипах.

**Surface привязан к venue.** Админ задаёт surface(s) для каждого стадиона в `/admin/venues` — multi-select из двух опций. У одного venue может быть оба (например, outdoor газон + indoor зал).

**Backend-токены (для БД и API):** `grass` / `hard`. UI-лейблы `Grass` / `Hard surface` — только на фронте. В БД `Venue.surface` — `text[]` (см. ERD в [app-map.md](./pitchup-app-map.md)), `Match.surface` — `text` (один из двух токенов, капитан выбирает из доступных у venue при создании). Валидация принадлежности к набору — на app-уровне (не Postgres enum, чтобы добавление третьего покрытия в будущем не требовало миграции).

**Шипы — на уровне матча, не venue.** У матча есть отдельное поле `studs_allowed` (boolean), капитан выставляет при создании:
- **Hard surface** → toggle скрыт, всегда `studs_allowed = false` (на паркете шипы не работают, обсуждать нечего)
- **Grass** → toggle виден, капитан выбирает сам (`Studs allowed: Yes / No`)

**"Bring:" на странице матча и MatchCard:**
| Surface | studs_allowed | "Bring:" |
|---|---|---|
| Grass | Yes | Studs or rubber |
| Grass | No | Rubber only (no studs) |
| Hard surface | — | Indoor shoes / trainers |

**Иконки на MatchCard:** 🌱 для Grass, 🏟️ для Hard surface. Рядом мини-бейдж `Studs OK` / `No studs` если Grass.

**Экзотика (sand, rooftop, gravel)** не выделяется отдельным типом. Админ выбирает ближайший Grass/Hard. Если правда станет нужно — заведём `Other` позднее.

### Статус брони поля
Капитан помечает, забронировано ли поле:
- **Field booked** — поле точно забронено, матч 100% состоится → зелёный бейдж `✓ Field booked`
- **Gathering players** — пока собираем людей, поле забронируем позже когда наберём кворум → жёлтый бейдж `⚠ Field not yet booked`

Два состояния, не три: `field_booked = true/false`. "Gathering players" — это просто `field_booked = false`.
Фильтр "Booked" показывает только матчи с `field_booked = true`. "Any" — все матчи.
Виден на MatchCard и на странице матча. Капитан переключает в `/matches/:id/edit` или сразу при создании.

### Тип матча
Два сценария создания:
1. **Open match** — капитан собирает всех с нуля (default). Например: "нужно 14 человек".
2. **Match with existing crew** — у капитана уже есть команда (друзья), ищут добор. Например: "нас 9, ищем +1".

> Не путать с состоянием карточки "Almost full" — это про матч у которого осталось ≤2 свободных слота (см. "Состояния матча" в [match.md](./pitchup-spec-match.md)).

Реализация: при создании капитан указывает **"Players coming with you"** — список имён друзей, которые играют точно (без капитана; капитан = его user-аккаунт). Каждое имя — свободный текст (first name, например `Pavel`). Эти записи хранятся на матче как `captain_crew: string[]` — просто массив строк, **не отдельные user-записи в БД, не stub-таблица**. Каждая занимает один слот.

> **Терминология.** Канонические термины — **"stub player"** (одна запись-имя в массиве `captain_crew`) и **"crew"** (массив этих stub'ов целиком, поле `captain_crew`). Никаких других синонимов в спеке быть не должно: "crew member", "crew-игрок", "named guest", "капитанский +1" — это всё про stub player. Pending/accepted real-users в `JoinRequest` к "crew" не относятся.

Дубликаты имён допустимы (двое Pavel'ов — норм). Лимит длины массива — `total_spots - 1` (капитан тоже занимает слот). Пустой массив = open match с нуля.

На карточке отображается:
- "9/10 · 1 spot left" — для crew с добором (1 капитан + 8 crew + 1 открытый)
- "3/14 · 11 spots open" — для open match

В Lineup такие записи рендерятся как серые PlayerChip'ы только с именем, без аватара, без ссылки на профиль (тап → tooltip `"Not on app yet"`). См. "Tab Lineup" в [match.md](./pitchup-spec-match.md).

Если `captain_crew.length + 1 == total` → матч полный сразу, доступна только кнопка `[Notify me]`.

**Crew ≠ guests.** Не путать:
- **Crew** = массив stub player'ов в `captain_crew` (см. термины выше). Список именованных stub-игроков, заданных капитаном **при создании матча**. Каждый stub = серый чип с именем, один слот.
- `guest_count` — анонимные `+N` на заявке любого игрока (0..4, см. "Гости (+N при подаче заявки)" ниже). Не имеют имён, рендерятся как бейдж `+N` на чипе хозяина.

**Что происходит, если реальный друг сам подаст Join.** Обычный approve — без модалок, без auto-detect, без сравнения имён. Капитан жмёт `[✓]`, pending → accepted, +1 к счётчику. На матче временно отображаются обе записи (серый stub + цветной real Pavel). Если капитан хочет схлопнуть — идёт в `[Edit match]` и удаляет stub из chip-input crew. Видимое действие, никакой скрытой "магии замены". Если на момент approve матч уже full — `[✓]` disabled (см. "Total spots — hard cap для approve" ниже). Подробнее — в "Approve flow" в [match.md](./pitchup-spec-match.md).

### Total spots — hard cap для approve
`Total spots` у матча — **жёсткий потолок для приёма игроков**. Капитан **не может апрувить заявку, если итоговый `filled` превысит `total`**.

- Backend в `POST /api/matches/:id/approve` проверяет `computeSlots({...match, accepted: [...accepted, request]}).filled <= capacity`. Если нет — возвращает `409 over_capacity`. UI капитана дублирует: кнопка `[✓]` рядом с pending **disabled** когда `1 + request.guest_count > computeSlots(match).free`, tooltip `"Not enough spots — increase Total or reject"`.
- Капитан хочет принять 12-го при total=10 — сначала `[Edit match] → Total spots [+]`, потом approve. Никакого "тихого overshoot" через approve.
- Для игрока UX-блок прежний: при `isFull` обычный Join скрыт, виден только `[Notify me]`.
- UI показывает реальные числа. Бейдж "Full" — при `filled >= capacity`.

**Join API НЕ проверяет free.** Это намеренно асимметрично с approve: pending **не занимает слот** (см. "Slot math" — pending не входит в `filled`), поэтому подача заявки на full-матч легитимна. Сценарий: watching-юзер, гонка с параллельным approve, либо просто игрок надеется на капитанский поднятие total — все они должны иметь возможность создать pending. Hard cap срабатывает на approve, не раньше.
- `POST /api/matches/:id/join` проверяет только `match.status === live` (не Cancelled/InProgress/Ended) и отсутствие активной заявки от того же юзера (idempotency). Free не сравнивается.
- UI: при `isFull` обычная кнопка `[Join match]` скрыта (видна только `[Notify me]`) — это **UX-shortcut**, не security. Watching-юзер на full-матче через `[Notify me]` в pending не уйдёт (его CTA — текстовая "будем уведомлять"), но если он каким-то путём (старая вкладка, прямой curl) пошлёт POST на Join — заявка создастся легитимно, капитан её увидит и решит сам.
- На **не-live** матче (`InProgress` / `Ended` / `Cancelled`) Join всегда возвращает `409 match_locked`. То же для матчей с прошедшим `start_time`, которые ещё ждут cron'а auto-reject — статус вычисляется on-read, не из БД-флага (см. "Состояния матча" в [match.md](./pitchup-spec-match.md)).

**Когда overshoot (`filled > capacity`) всё-таки возможен:** только как следствие **Edit total ↓** (капитан уменьшил total ниже current accepted — см. ограничения в `/matches/:id/edit` в [match.md](./pitchup-spec-match.md)) или гонок с заявками, которые отшибает backend-блок. Штатный approve overshoot не создаёт.

### Гости (+N при подаче заявки)
**Любой матч принимает заявки с гостями.** Отдельного флага у матча (типа `Allow +1`) нет — это всегда возможно, капитан решает на этапе approve.

- В Join-модалке игрок видит **stepper "Bringing friends" 0..4** (default 0). Один игрок может привести от 0 до 4 безымянных гостей. Лимит 4 — практический потолок, на 6v5 это уже край здравого смысла.
- Заявка хранит `guest_count` (целое 0..4). Слотов суммарно занимает `1 + guest_count`.
- Капитан в captain sheet / Tab Lineup видит pending как `Ivan Novak (+3)` если игрок взял 3 гостей. Тап на `[✓]` апрувит со всеми гостями сразу — отдельно гостей нельзя отрезать. Если `1 + guest_count > free` — кнопка `[✓]` disabled, tooltip `"Not enough spots — increase Total or reject"` (см. "Total spots — hard cap для approve" выше). Капитан выбирает: реджектить, или поднять total через `[Edit match]` и тогда апрувить.
- В Lineup accepted-игрок отображается одним PlayerChip с бейджем `+N` (если N > 0). Слот-счётчик матча включает гостей: `Ivan +3` = 4 слота. Сами гости отдельными чипами не рендерятся.
- **Leave / Kick:** Ivan уходит или кикается → освобождаются все его слоты (1 + N). Гости неотделимы от хозяина.
- **После accept изменить число гостей нельзя.** Хочешь меньше/больше — Leave и подай снова. Сознательное упрощение.

> Из ранних версий спеки убрали поле матча `Allow "+1"` и кнопку `Join +1`. Не путать.

### Slot math

**Единая формула заполненности матча.** Используется везде где упоминаются слоты (счётчик MatchCard, валидация approve, CTA bar isFull-проверка, бейджи "Almost full" / "Full", watching-триггер при освобождении, Edit total preview).

```
filled   = 1 (captain) + captain_crew.length + Σ(accepted JoinRequest: 1 + guest_count)
capacity = match.total_spots
free     = max(0, capacity - filled)
isFull   = filled >= capacity
```

**Соглашение:** всё что считает слоты — зовёт **одну функцию** `computeSlots(match) → { filled, capacity, free, isFull }`. Никаких локальных пересчётов в компонентах / API-хендлерах / SQL-выражениях. Это единственный способ гарантировать что UI, backend-валидация и БД-инварианты не разойдутся.

**Approve hard cap.** Backend на approve не даёт `filled > capacity` (см. "Total spots — hard cap для approve" выше). Формула честно возвращает `free = 0` и `isFull = true` при `filled == capacity`, никаких отрицательных чисел.

**Overshoot (`filled > capacity`)** в БД возможен в одном кейсе: капитан/админ через Edit уменьшил `total_spots` ниже текущего `accepted` count (если фронт это позволил — см. `/matches/:id/edit` в [match.md](./pitchup-spec-match.md), где stepper по умолчанию **не разрешает** ставить ниже current accepted). На случай если такая запись всё же образуется (история, миграция, ручное вмешательство в БД) — формула возвращает `free = 0` и `isFull = true`, UI рендерит честные `11/10 players` без падений.

**Что НЕ входит в `filled`:** pending JoinRequest, watching-флаги, rejected/kicked/left записи. Только accepted и crew.

### Уведомления

**Три канала:** email, in-app inbox, и browser notifications (Notification API). Web Push (сервис-воркер, нужен для iOS Safari и фоновых уведомлений) отложен до v1.1 вместе с PWA.

**Email — узкий канал, только критичные события для самого юзера:**
| Событие | Кому |
|---|---|
| ✓ Approved (твою заявку приняли) | игроку чья заявка |
| ✗ Kicked (тебя выкинули из матча) | кикнутому игроку |
| 💬 Morning-of-match reminder | всем accepted + капитану матча. **Два запуска в день:** 10:00 Prague (матчи сегодня, `start_time >= now()`) · 20:00 Prague (матчи завтра с `start_time` до 12:00). Расписания зарегистрированы в TZ **`Europe/Prague`, не UTC** — это критично для DST: переход на/с летнего времени должен сдвигать UTC-час cron'а автоматически, иначе в марте и октябре утренний пуш уползёт на час. Подробнее — в "Cron-задачи" в [match.md](./pitchup-spec-match.md) |

Всё. Других email в v1 не шлём. Управляется одним toggle "Email notifications" в `/me` (см. Section NOTIFICATIONS в [personal.md](./pitchup-spec-personal.md)). Выключил — не приходит ничего, риск своей. Reject pending и match cancelled на email **не шлём** — игрок узнаёт об этом в in-app inbox / при заходе в приложение.

**In-app inbox = панель Updates по тапу на 🔔 в TopBar.** Отдельной страницы `/notifications` в v1 нет. Toggle её не отключает — inbox работает всегда.
- **Red dot на 🔔** появляется когда есть непрочитанные. Без счётчика — точное число видно внутри панели. Обновляется в realtime через **глобальный SSE-канал** `/api/updates/stream` (см. "Real-time sync" ниже), независимо от текущей страницы.
- **Панель Updates:** bottom-sheet. Заголовок "Updates", список последних до 20 нотификаций по убыванию времени. **Mark-as-read при открытии** = `UPDATE notification SET read_at = now() WHERE user_id = ? AND read_at IS NULL` — **без `LIMIT`**, помечаются прочитанными ВСЕ непрочитанные нотификации этого юзера, включая те которые не влезли в top-20 (старее 20-го по позиции). Это сознательно: red dot гаснет полностью, никаких "скрытых непрочитанных". Кнопки `[Show older]` / пагинации `<` `>` в v1 **нет** — старше 20-го юзер увидеть не может (только через миграцию хранилища или прямой SQL). Это **известный пробел** (см. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md)) — если по фидбеку появится — добавим infinite-scroll по `(user_id, created_at DESC)` индексу.
- **Структура айтема:** иконка по типу (✓ approved / ✗ declined / 🚫 kicked / ⚠ cancelled / 🔄 updated / 💬 reminder / 🟢 spot opened) + одна строка текста + относительное время ("2h ago"). Тап → ведёт на `/matches/:id`. Панель закрывается.
- **События, которые попадают в inbox:**
  - approve / reject заявки
  - kick
  - match cancelled — **для accepted И для pending** (pending тоже получает `match_cancelled` notification, body: "Your request was declined — match was cancelled"; см. "SSE `action` → `notification.type` mapping" в "Real-time sync" ниже)
  - match details updated (для accepted, **только material changes** — `start_time`/`duration`/`venue`/`surface`/`studs_allowed`/`price`/`field_booked`; non-material `total_spots`/`captain_crew`/`description` — silent, см. "Real-time sync" ниже)
  - spot opened up (для watching — когда слот освободился; и для капитана **при Leave** — юзер ушёл сам, капитан об этом не знал. При Kick и Edit total↑ captain сам инициировал освобождение слота — пуш не приходит; см. `notify watching` в [match.md](./pitchup-spec-match.md))
  - morning-of-match reminder (дублируется и в email, и в inbox)
- **Mark as read:** открытие панели = вся пачка прочитана, red dot гаснет. Никаких "пометить как непрочитанное" или "удалить" в v1.
- **TTL:** 30 дней. Старше — авто-чистка кроном (`Inbox TTL cleanup`, раз в сутки, см. таблицу cron'ов в [app-map.md](./pitchup-app-map.md)).
- **Пустое состояние:** "No updates yet".

**Модель данных** (источник правды — ERD в [app-map.md](./pitchup-app-map.md), сущность `Notification`):
- Таблица `notification(id, user_id, type, match_id, body, created_at, read_at)`. `type ∈ { approved, rejected, kicked, match_cancelled, match_updated, spot_opened, morning_reminder }`. `match_id` nullable на будущее (для типов без матча); в v1 все события про матч, так что заполнено всегда. `body` — готовая текстовая строка ("Your request was declined — match was cancelled"), без шаблонов на клиенте.
- **Index:** `(user_id, created_at DESC)` — выборка для панели Updates.
- **Red dot:** `EXISTS (notification WHERE user_id=? AND read_at IS NULL)`. Bool, не счётчик.
- **Mark-as-read:** при открытии панели Updates → `UPDATE notification SET read_at = now() WHERE user_id=? AND read_at IS NULL`. Затем эмит SSE `notification_read_sync { all: true }` для других вкладок этого юзера.
- **Запись новых:** все триггеры (approve, reject, kick, cancel, edit, spot opened, morning reminder, admin actions) выполняют `INSERT notification(...)` **внутри той же транзакции** что и основная операция (см. "Конкурентность и блокировки" в [match.md](./pitchup-spec-match.md) — `notification`-записи внутри транзакции, эмиссия SSE — после commit'а). После commit'а — `notification_added` SSE-event.
- **Дедупликация:** не требуется в v1 — каждое событие записывается как новая строка, даже если юзер получил три одинаковых "spot opened" подряд. Спам решается дизайном (watching снимается после первого пуша, edit details шлёт только accepted и т.д.), не БД-констрейнтами.

**Browser notifications (Notification API) — третий канал, опциональный:**
- Работает на десктопе (Chrome, Firefox, Safari 16.4+) и Android Chrome **без PWA и без сервис-воркера**. На iOS Safari без добавления на Home Screen не работает — в v1 не обещаем. Frontend определяет платформу: на iOS toggle **скрыт** (чтобы не создавать ожидания). **Детект iOS — по User Agent (`/iPhone|iPad|iPod/i.test(navigator.userAgent)`)** — все браузеры на iOS (Chrome, Firefox, Edge, любые) внутри используют системный WKWebView и наследуют те же ограничения Notification API что и Safari, поэтому достаточно проверить устройство, а не движок/бренд. Никаких feature-detect'ов через `Notification in window` — на iOS оно может быть, но фактически не работает.
- **Когда стреляет:** SSE событие `notification_added` получено **И** `document.hidden === true` (юзер не смотрит на вкладку). Если вкладка активна — in-app inbox уже справляется, дублировать не нужно.
- **Какие события:** те же что в in-app inbox — approve, reject, kick, match cancelled, spot opened, match details updated. Morning reminder **не дублируем** (email это закрывает, browser popup в 10 утра — избыточно).
- **Permission flow:** тап на toggle → если `Notification.permission === 'default'` → браузер показывает нативный запрос. Разрешил → toggle on, сохраняем `browser_notifications: true` в **localStorage** (не в DB — пермишен браузерный, не аккаунтный; разные устройства независимы). Заблокировал → toggle остаётся off + toast "Notifications blocked. Allow them in browser settings."
- **Если юзер потом заблокировал в настройках браузера:** при следующем `notification_added` → `new Notification()` бросает ошибку → frontend ловит → toggle флипается обратно в off + toast "Browser notifications were blocked. Re-enable in browser settings."
- **Re-sync на mount `/me`.** На каждый mount страницы `/me` фронтенд сверяет `localStorage.browser_notifications` с актуальным `Notification.permission`:
  - `permission === 'denied'` → принудительно `flag = false` (юзер мог заблокировать через site-settings браузера между сессиями; не светим устаревший `on` в UI)
  - `permission === 'granted'` И `flag === true` → оставляем как есть
  - `permission === 'granted'` И `flag === false` → оставляем `false` (юзер сам выключил toggle при наличии разрешения — это намеренный opt-out)
  - `permission === 'default'` → принудительно `flag = false` (юзер сбросил permission в браузере; следующее включение toggle снова попросит permission)
  Это закрывает рассинхрон "browser permission снят извне → в UI toggle всё ещё показан `on`".
- **Payload уведомления:** заголовок = название матча или "PITCHUP", тело = тот же текст что в in-app inbox айтеме. Тап → `window.focus()` + navigate на `/matches/:id`.
- **Дедупликация между вкладками:** SSE `notification_added` прилетает во **все** открытые вкладки юзера, и в каждой `document.hidden === true` (если все в фоне) — без защиты получили бы N popup'ов на одно событие. Решение: `new Notification(title, { tag: \`notif:${notification.id}\`, body, ... })`. Браузер схлопывает уведомления с одинаковым `tag` — вторая (и последующие) вкладки не плодят дубль, а заменяют существующее без повторного звука/popup (`renotify: false` по умолчанию). Нулевая координация между вкладками. На некоторых старых Safari / Linux DE возможно кратковременное моргание перед схлопыванием — для v1 приемлемо.

### Real-time sync (глобальный SSE-канал)

Per-match SSE на `/api/matches/:id/stream` (см. Tab Chat в [match.md](./pitchup-spec-match.md)) обновляет только страницу конкретного матча. Но юзеру нужно реагировать на события **глобально** — red dot на 🔔, актуальные секции на `/my-matches`, unread dots в `/chats` — независимо от того, на какой странице он сейчас сидит. Для этого — отдельный канал.

**Эндпоинт:** `GET /api/updates/stream` — long-lived SSE на залогиненного юзера. Сервер пушит события, перечисленные ниже. Подписка устанавливается при загрузке любой залогиненной страницы (один SSE на вкладку), закрывается при logout / закрытии вкладки. **Fallback:** если SSE недоступен — polling `GET /api/updates/state` каждые 30 сек (та же логика что для match-stream, см. Tab Chat в [match.md](./pitchup-spec-match.md)).

**События в канале:**

| Событие | Payload | Что обновляет на клиенте |
|---|---|---|
| `notification_added` | `{ id, type, match_id?, body, ts }` | Increment unread count → red dot загорается. Если открыта панель Updates — добавляется новый айтем в начало списка. **Browser notifications: фронт фильтрует по `type`** — для `morning_reminder` browser popup подавляется (email + in-app уже закрывают канал, 10 утра — неуместный popup); все остальные типы пробрасываются стандартно (см. "Browser notifications" выше). |
| `notification_read_sync` | `{ all: true }` или `{ ids: [...] }` | Multi-tab consistency: открыл inbox в одной вкладке — red dot гаснет во всех остальных. |
| `my_match_changed` | `{ match_id, my_status: accepted \| pending \| declined \| kicked \| cancelled \| watching \| none, action: ... }` | Generic refresh trigger для `/my-matches` (секции Captain/Upcoming/Past пересчитываются, "Your next match" укрупнённая карточка обновляется если затронут ближайший матч) и `/chats` (карточка матча появляется/исчезает в зависимости от смены доступа к чату). Также используется для синхронизации с per-match SSE — если юзер открыт на странице этого матча, обе подписки получают consistent state. |
| `chat_message_received` | `{ match_id, ts }` | На `/chats` карточка матча поднимается наверх списка, ставится unread dot. Если юзер прямо сейчас на `/matches/:match_id` с активным Tab Chat — событие игнорируется (per-match SSE уже показал сообщение). |
| `chat_read_sync` | `{ match_id }` | Multi-tab consistency: открыл Tab Chat в одной вкладке и прочитал — unread dot на `/chats` гаснет во всех остальных вкладках. |

**Что НЕ через этот канал:**
- Per-match чат, Lineup updates на странице матча — это `/api/matches/:id/stream` (per-match SSE), отдельный канал; не дублируем чтобы не плодить трафик.
- MatchCard slot counters в списках `/games` / `/map` — обновляются on-read при загрузке страницы / pull-to-refresh. Push'ить туда realtime смысла нет (слишком много матчей, слишком частые мелкие изменения, низкая ценность).
- Профиль другого юзера на `/users/:id` — статика, ребилд при навигации.

**Дедупликация при перекрытии с per-match SSE:** если юзер на странице матча X, он получает события и из `/api/matches/X/stream`, и из глобального `/api/updates/stream` (через `my_match_changed`). Frontend идемпотентен: оба пути ведут к тому же state-update. Никаких "первый прилетел — второй игнорируем", просто стандартный re-render по актуальному состоянию.

**`my_status` — UI-derived, не = `JoinRequest.status`.** Enum в SSE-payload синтетический: складывается из роли юзера на матче, наличия JoinRequest и его `auto_reason`. Mapping:

| `my_status` | Откуда вычисляется (on-read из БД) |
|---|---|
| `accepted` | `JoinRequest.status === 'accepted'` И `match.cancelled_at IS NULL` |
| `pending` | `JoinRequest.status === 'pending'` |
| `declined` | `JoinRequest.status === 'rejected'` (любой `auto_reason`, включая NULL/`match_started`/`match_cancelled`) |
| `cancelled` | `JoinRequest.status === 'accepted'` И `match.cancelled_at IS NOT NULL` — JoinRequest.status при cancel матча **не меняется** (pending → rejected, accepted — остаётся accepted); `cancelled` derives from match flag |
| `watching` | Watch-запись есть И `JoinRequest.status ∉ {pending, accepted}` (включая случай когда JoinRequest отсутствует) |
| `none` | `JoinRequest.status ∈ {left, kicked, cancelled}` — юзер покинул матч / отозвал заявку / был кикнут; CTA-роль `none`, может переподать через `[Join match]` / `[Notify me]` (UPSERT UPDATE в pending) ИЛИ нет Watch-записи И нет JoinRequest вообще |

> **`kicked` в SSE-payload.** `my_status = 'kicked'` существует **только в `my_match_changed`-payload** как сигнал фронту проиграть анимацию карточки Upcoming → Past. On-read вычисление при перезагрузке: `JoinRequest.status === 'kicked'` → `my_status = 'none'` (kicked юзер может переподать). Section Past показывает kicked-юзера с sub-label "You were removed" — эта логика берёт `JoinRequest.status` напрямую, не через `my_status`.
>
> **`cancelled` (match cancel) — JoinRequest accepted игроков не меняется.** Endpoint `POST /cancel` делает только "mass-reject pending + UPDATE match.cancelled_at". Accepted JoinRequest остаются как accepted. На UI `my_status = 'cancelled'` выводится on-read из `match.cancelled_at IS NOT NULL` — не из смены статуса строки. Это намеренно: Section Past находит таких юзеров по `JoinRequest.status === 'accepted'` + `match.status === Cancelled`.

> **`rejected` (БД) vs `declined` (UI/SSE) — единый словарь.** Канонический mapping для одного и того же состояния:
> - **БД:** `JoinRequest.status = 'rejected'` (одно значение, любой `auto_reason` — captain reject, `match_started`, `match_cancelled`)
> - **UI label:** "Declined" / "Request declined" (в Section Past карточки, в notification body)
> - **SSE `my_status`:** `'declined'`
>
> Других синонимов нет. Не пишем "rejected" в UI, не пишем "declined" в БД-схеме, не вводим `rejected_at` поля с UI-семантикой и т.д. Если где-то в спеке появилось рассогласование — это баг спеки, а не вариант на выбор.

**`action` — полный enum.** Поле `action` в `my_match_changed` сообщает фронту **что именно случилось**, чтобы выбрать анимацию и куда переместить карточку (анимация и текст уведомления берутся из `notification.body` отдельно — см. примечание ниже). Допустимые значения:

| `action` | Триггер | `my_status` | Что делает фронт |
|---|---|---|---|
| `requested` | Юзер тапнул Join (POST /join) | `pending` | Добавить карточку в `/my-matches → Section Upcoming` с бейджем `Waiting…`. Эмитится для остальных вкладок юзера (свою вкладку фронт обновляет сразу). |
| `request_cancelled` | Юзер сам отменил pending (POST /cancel-request) | `none` | Убрать `Waiting…` карточку из Upcoming. Эмитится для остальных вкладок. |
| `accepted` | Captain approve (POST /approve) | `accepted` | Карточка перерисовывается с бейджа `Waiting…` на `You're in ✓`. Появляется в `/chats`. |
| `captain_rejected` | Captain reject pending (POST /reject) | `declined` | `Waiting…` карточка уходит из Upcoming в Past как `"Request declined"`. |
| `match_started` | Cron auto-reject pending (start_time прошёл) | `declined` | То же что captain_rejected, но текст body отличается. См. "Cron auto-reject" в [match.md](./pitchup-spec-match.md). |
| `match_cancelled` | Captain cancel match (POST /cancel) | `cancelled` (если был accepted) / `declined` (если был pending) | Карточка → Past. Для accepted — как `"Match cancelled"`, для pending — `"Request declined · match cancelled"`. |
| `left` | Юзер сам ушёл из accepted (POST /leave) | `none` | Убрать карточку из Upcoming (и из `/chats`). Эмитится для остальных вкладок. JoinRequest-row **остаётся в БД** со `status='left'` — ушедший появляется в Section Past как "You left". Re-apply после Leave — UPSERT UPDATE обратно в `pending`. |
| `kicked` | Captain kick (POST /kick) | `kicked` (UI-only enum) | Карточка уходит из Upcoming (и из `/chats`). JoinRequest-row **остаётся в БД** со `status='kicked'` — кикнутый появляется в Section Past как "You were removed". Re-apply после Kick — UPSERT UPDATE обратно в `pending`. |
| `match_updated` | Captain edit (PATCH /matches/:id) | без изменения (роль не трогаем) | Перерисовать карточку с новыми данными (время не меняется — venue, total, surface, description, price, field_booked); если был accepted и сейчас на странице матча — обновить также Tab Details / Lineup-счётчик. |
| `admin_deleted` | Admin hard-delete (DELETE /admin/matches/:id) | `cancelled` (placeholder — карточка всё равно удаляется) | Убрать карточку из всех списков (Captain / Upcoming / Chats) **без перемещения в Past**. Подробнее — см. "/admin/matches" в [personal.md](./pitchup-spec-personal.md). |

**SSE `action` → `notification.type` mapping.** Каждое `my_match_changed`-событие (где это применимо) сопровождается записью в `notification`-таблице с соответствующим `type`. Связь:

| SSE `action` | `notification.type` | Комментарий |
|---|---|---|
| `accepted` | `approved` | |
| `captain_rejected` | `rejected` | body: "Your request was declined" |
| `match_started` (cron auto-reject pending) | `rejected` | body: "Match started — your request expired" |
| `kicked` | `kicked` | |
| `match_cancelled` (для accepted) | `match_cancelled` | body: "Match cancelled — [reason]" |
| `match_cancelled` (для pending) | `match_cancelled` | body: "Your request was declined — match was cancelled" |
| `admin_deleted` | — | **Notification НЕ создаётся.** SSE `my_match_changed` шлётся только для re-render списков (убрать карточки из Captain/Upcoming/Chats). Подробнее — `/admin/matches → [Delete]` в [personal.md](./pitchup-spec-personal.md). |
| `match_updated` | `match_updated` | **Только для material changes** — см. ниже. body содержит список изменённых полей. |
| `spot_opened` (отдельный SSE-event, не `my_match_changed`) | `spot_opened` | для watching-подписчиков |
| `morning_reminder` (cron, не из SSE-action) | `morning_reminder` | дублируется в email |
| `request_cancelled` (юзер сам отменил pending) | — | **НЕ создаёт notification**, только SSE для синка вкладок |
| `left` (юзер сам ушёл из accepted) | — | НЕ создаёт notification, только SSE |

**`match_updated` — material vs non-material changes.** Не каждый Edit капитана шлёт уведомление:
- **Material changes (notify accepted):** `start_time`, `duration`, `venue_id`, `surface`, `studs_allowed`, `price`, `field_booked`. body: "Match updated: [список изменённых полей человеческим текстом]".
- **Non-material (silent):** `total_spots`, `captain_crew`, `description`. Меняем матч, SSE `my_match_changed` шлём для перерисовки карточек, но `notification` НЕ создаём и `match_updated` `notification.type` не пишем. Pending-юзера это тоже не задевает.

Подробнее про material/non-material — см. `/matches/:id/edit` в [match.md](./pitchup-spec-match.md).

**Watching-переходы (`none ↔ watching`)** через `my_match_changed` **не эмитятся** в v1 — Watch снимается в `notify watching` пуш-uveдомлением в inbox, а карточки `👀 Watching` в Upcoming могут оставаться стейловыми до следующего рендера `/my-matches`. Это сознательное упрощение, см. "Watching логика" в [match.md](./pitchup-spec-match.md).

> **Текст уведомления берётся из `body` notification-записи, не из `my_status`.** `my_status` — это UI-state enum для переходов карточек (Upcoming → Past, бейдж "Waiting…" → исчезает, и т.д.); он схлопывает три разных `auto_reason` (`NULL` = captain reject, `match_started`, `match_cancelled`) в один `declined`. Конкретная формулировка ("Your request was declined" vs "Your request was declined — match has started" vs "Your request was declined — match was cancelled") живёт в `notification.body`, которая записывается при `INSERT notification(...)` внутри транзакции исходного события. Frontend на `notification_added` просто рендерит `body` как есть — без шаблонов и веток по `type`. Поле `action:` в `my_match_changed`-payload'е используется только для UI-перехода (какую анимацию проиграть в `/my-matches`), не для текста — текст уже в inbox.

**Auth:** при разрыве токена / banned-юзере / удалении аккаунта в другой вкладке сервер перед закрытием SSE шлёт служебный event `auth_revoked` с полем `reason ∈ { 'banned' | 'deleted' | 'session_expired' }` и сразу закрывает соединение (следующий heartbeat / попытка прочитать session всё равно отдаст `401` — это страховка для случая, когда event не успел доставиться). **Механизм межпроцессной доставки:** SSE-handler подписан на Postgres-канал `sse_revoke:{user_id}` через `LISTEN`. При ban/delete-account — `INSERT INTO revoked_sessions` + `NOTIFY sse_revoke:{user_id}` в одной транзакции; SSE-процесс получает notify и шлёт `auth_revoked` event перед закрытием. Heartbeat-проверка `jti` против `revoked_sessions` — независимый fallback на случай если notify не дошёл (рестарт процесса, потеря соединения с БД). Frontend ловит либо `auth_revoked`, либо `401` и редиректит по `reason`: `banned` → `/login?error=banned` (banned-экран, см. ниже), `deleted` и `session_expired` (а также голый `401` без события) → `/login` без параметра. Та же логика применяется и к per-match SSE `/api/matches/:id/stream`. Согласовано с поведением в "Бан / удаление аккаунта" ниже (deleted → `/login`, banned → `/login?error=banned`).

### Бан / удаление аккаунта
Два сценария удаления юзера из системы:
- **Ban** (админом) — перманентный, снимается только админом вручную через `[Unban]` в `/admin/users`. Юзер не может войти: после успешного Google OAuth backend проверяет флаг `banned` и **сбрасывает сессию** (никакой session cookie не выставляется), любой `callbackUrl` **игнорируется**, юзера выкидывает на `/login?error=banned`. На этой странице банd-юзеру **скрыт весь нормальный контент** (кнопка Google OAuth, disclaimer) — виден только banned-экран с возможностью написать апелляцию (см. "Banned state" в секции `/login` ниже). Профиль на `/users/:id` → "This user is no longer on PITCHUP." (см. ниже — единый текст для banned и deleted, privacy-considerations).
- **Delete account** (сам юзер из `/me` → Section ACCOUNT ACTIONS) — необратимо. Профиль удаляется, на `/users/:id` → "This user is no longer on PITCHUP." (тот же текст что и для banned).

> **Унифицированный текст на `/users/:id` для banned и deleted — "This user is no longer on PITCHUP."** Сознательно privacy-driven: не различаем "забанен модерацией" vs "сам удалил аккаунт" в публичном UI. Сторонний наблюдатель не должен видеть, был ли юзер забанен (это инфа для модерации, не для всех). Текст один, поведение страницы одно. Внутри админки `/admin/users` разделение есть — там это нужно для работы.

**Последствия для матчей** (одинаково для ban и delete):
- **Когда выполняется:** синхронно в той же транзакции, что и ban/delete (не on-read, не cron). К моменту, когда админ видит "User banned" / юзер видит "Account deleted", все каскадные отмены и уведомления уже поставлены в очередь. Это важно, иначе матч висел бы открытым ещё несколько минут и кто-то успел бы Join.
- **Капитан upcoming матчей** → все его upcoming матчи (статус Open/AlmostFull/Full, `start_time > now()`) **авто-отменяются** с причиной "Organizer account was removed". Игроки получают обычное уведомление об отмене, на странице — стандартный баннер cancelled. **InProgress матчи не трогаем** — они уже идут, юзер уже на поле; пусть Ended обычным путём. Past матчи капитана не трогаем — они нужны для истории и лайков.
- **Ghost-match (InProgress без активного капитана).** Edge-кейс: капитан удалил аккаунт / забанен во время InProgress собственного матча. Матч живёт дальше как обычно: статус по таймеру переедет в Ended, чат продолжает работать для accepted, лайки между accepted доступны после Ended. **Captain sheet, Edit, Cancel, Shuffle teams** на ghost-match никем не открываются (sheet был доступен только capt'у, capt'а нет; админ через `/admin/matches → [Edit]` / `[Cancel]` тоже не пройдёт — `[Edit]` disabled на InProgress/Ended, `[Cancel]` тоже). В Lineup `Organizer: [Removed user]`, серый дефолтный аватар, не кликабелен. Like-модалка после Ended показывает ростер без себя — `[Removed user]` в ростер не попадает (некого лайкать), accepted лайкают друг друга нормально. Если accepted один и больше никого — модалка пустая, юзер закрывает и идёт жить дальше. Сознательное упрощение: спека не плодит "передачу капитанства на лету" ради этого редкого кейса.
- **Accepted/pending/watching в чужих матчах** → его записи удаляются, слоты освобождаются. Капитан + watching-игроки получают уведомление "A spot opened up" (если был accepted). Pending — просто исчезает. Watching-подписка удаляется без уведомления. В Lineup и чате имя заменяется на "[Removed user]".
- **`[Removed user]` в UI — без вспомогательной инфы.** Где бы ни рендерился такой юзер (Tab Lineup, Tab Chat author, Like-модалка ростер, мини-ростер на MatchCard, OG-превью): только дефолтный серый аватар + строка `[Removed user]` (не кликабельна, тапа на `/users/:id` нет — там 404). Никаких имени, contact info, счётчика лайков `👍 N`, бейджа Captain, бейджа `+N guests`, тултипов. Это сознательно: профиля больше нет, любые подробности — мусор и source of confusion. Лайки в БД остаются (для целостности подсчёта матчей с участием этого юзера в прошлом), но UI их под `[Removed user]` не отображает.
- **Сообщения в чате** — остаются (иначе порвётся история). Имя автора → "[Removed user]", аватар → дефолтный. **Автор резолвится на render-time**, не на write-time: при каждом рендере чата backend джойнит `ChatMessage.author_id → users` и проверяет `banned` / отсутствие row. Поэтому сообщения юзера, который был активен на момент отправки и забанен/удалён позже, рендерятся как `[Removed user]` ретроспективно — без миграции старых записей и без денормализации `author_name_snapshot` в `ChatMessage`. Тап на автора в чате `[Removed user]` **отключён** (выключает общее правило "тап на чат-автора → `/users/:id`" из Tab Chat в [match.md](./pitchup-spec-match.md) — некуда вести, `/users/:id` отдаст 404 / banned-screen).
- **Лайки от/к этому юзеру** — лайки от него удаляются. Лайки к нему остаются в БД (они на матче, не на юзере), но в UI под `[Removed user]` не показываются (см. выше).
- **Watch-записи** (флаг "Notify me" на full-матчах, см. [match.md](./pitchup-spec-match.md)) — все Watch-подписки юзера удаляются в той же транзакции, **без уведомления капитанам** этих матчей. Watch — анонимный флаг, его исчезновение не событие (симметрично с "Watching логика" в [match.md](./pitchup-spec-match.md), где Watch снимается при join/leave/cancel без шума). Если матч был full и watch-подписка этого юзера была единственной — никто, кроме него, и не узнал бы.
- **Запись в чужие чаты** — banned/deleted юзер не может слать новые сообщения. `POST /api/matches/:id/messages` отбивается **двумя независимыми проверками**: (1) `users.banned = false` — режет banned-юзера; (2) наличие записи `JoinRequest accepted` ИЛИ captain-роли на матче — режет deleted-юзера (его записи accepted удалены, а captain-флаг переустановлен в рамках авто-cancel'а собственных upcoming матчей). Обе проверки независимо возвращают `403` — двойной отбой, не один. Старые сообщения остаются с автором `[Removed user]` (см. выше), но новых от этого аккаунта в чат не попадёт.
- **Captain-tools у banned-капитана.** Если у юзера `is_captain` на каком-то матче и одновременно `banned = true` (редкий, но возможный кейс: ghost-match InProgress, где капитан забанен пока матч уже идёт — см. "Ghost-match" выше), любые captain-mutating endpoints (`POST /approve`, `POST /reject`, `POST /kick`, `PATCH /matches/:id`, `POST /cancel`, `DELETE /api/matches/:id/messages/:msg_id`) отбиваются с `403 forbidden` по той же проверке `users.banned = false`. Captain sheet / inline `[Delete]` / `[Edit match]` к этому моменту юзеру уже недоступны через UI (SSE `auth_revoked` закрыло его сессию при бане, см. "Real-time sync" выше), но backend backstop нужен от любых открытых вкладок с закешированным DOM или прямых curl'ов. Модерация чата в ghost-match'е забаненного капитана ложится на админа на уровне матча целиком — `[Hide text ▾]` в `/admin/matches` для description / cancel_reason, либо `[Delete]` (hard delete матча) для нелегитимных кейсов. Per-message модерация в чате забаненного капитана в v1 невозможна (см. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md)).
- **Открытые SSE-соединения** — в транзакции ban/delete сервер инсертит все известные `jti` юзера в `revoked_sessions` (см. "Аутентификация" выше — JWT-based session, серверного store нет, инвалидация идёт через revoke-list). Все его открытые SSE-каналы — глобальный `/api/updates/stream` и per-match `/api/matches/:id/stream` (см. "Real-time sync" выше и Tab Chat в [match.md](./pitchup-spec-match.md)) — при следующем heartbeat проверяют `jti` против `revoked_sessions`, отдают `401` и закрываются. Аналогично любой mutating endpoint от этого юзера на любой вкладке мгновенно режется `401`. Клиент в открытых вкладках перехватывает `401` и редиректит: deleted → `/login` (без error), banned → `/login?error=banned` (banned-экран). До закрытия соединения (окно между событием ban/delete и ближайшим heartbeat'ом, ≤30 сек) юзер технически ещё получает события — допускаем, не критично.

При **unban** профиль и матчи **не восстанавливаются** — только возможность снова логиниться. Делает новый профиль = идёт обычный flow через онбординг? Нет, профиль остаётся как был (имя/аватар/contact info), просто снимается флаг banned. Матчи которые отменили — не возвращаются.

**`is_admin` сохраняется при ban.** Флаг `is_admin` **не сбрасывается** при бане — он живёт независимо от `banned`. Это важно для last-admin guard и audit-логики: в счётчике активных админов используется предикат `is_admin = true AND banned = false`, и забаненный админ в нём не учитывается (см. "Admin role management & safety" в [personal.md](./pitchup-spec-personal.md) — `count(is_admin=true, banned=false)`). При unban флаг возвращается в строй автоматически вместе с правами. Если нужно разжаловать админа окончательно — это **отдельная операция** (`[Demote to user]` в `/admin/users`), и она имеет свой last-admin предикат.

### Bootstrap первого админа
`/welcome` всегда вставляет `is_admin = false`, а `[Promote to admin]` доступен только из `/admin/users` — то есть существующему админу. Курица и яйцо. Решение для v1: первый админ ставится **вручную в БД** один раз после деплоя:

```sql
UPDATE users SET is_admin = true WHERE email = '<owner-email>';
```

Никаких ENV-флагов "первый залогинившийся = админ", seed-скриптов, секретного `/bootstrap` route — это всё каналы для случайных эскалаций. Дальше админы плодятся через `[Promote to admin]` в `/admin/users` (см. [personal.md](./pitchup-spec-personal.md)). Защита от потери последнего админа описана там же в "Admin role management & safety".

### Валидация и санитизация текстовых полей

Все пользовательские текстовые поля — plain text, не rich text/HTML.

**Правила на бэкенде (при каждом INSERT/UPDATE):**
- `.trim()` — все строковые поля
- `.normalize('NFC')` — Unicode-нормализация, предотвращает дубли "одинаковых" строк
- Проверка max length → `400 {field}_too_long`
- `captain_crew`: дополнительно strip пустых строк из массива после trim

**Лимиты:**

| Поле | Max length |
|---|---|
| `captain_crew` — одно имя | 30 chars |
| `description` (матч) | 2000 chars |
| Сообщение чата | 500 chars |
| `cancel_reason` | 200 chars |
| Report comment | 500 chars |
| Contact info | 200 chars |

**XSS:**
React JSX автоматически escapes всё в `{text}` — `dangerouslySetInnerHTML` не используем нигде без sanitize. Единственное исключение: **Contact info** — ссылки в профиле рендерятся кликабельными (`<a href>`). Разрешённые схемы: `http`, `https`, `mailto`, `tel`. WhatsApp-ссылки оформляются через `https://wa.me/` и покрыты схемой `https` — отдельной `whatsapp://` схемы нет (deep link не работает на десктопе). Всё остальное (`javascript:`, `data:`, `tg:`, `whatsapp:` и т.п.) — strip, рендерим как plain text без `<a>`. Telegram-ссылки через `https://t.me/username` (схема `tg://` нестабильна). `tel:+420...` — рабочая схема на мобильных (тап → системный dialer) и на десктопе (handler настраивается ОС, обычно Skype/FaceTime).

**Description матча, сообщения чата, cancel_reason, report comment, captain_crew** — рендерятся как **plain text**. URL внутри них в `<a href>` **не превращаются** — даже если капитан написал `https://goo.gl/maps/...` в description, ссылка останется текстом, юзер её копирует руками. Сознательно: уменьшает площадь атаки (один путь sanitization для всего, кроме Contact info), снижает спам-ссылочный шум в публичной ленте и в чате. Если капитану нужна карта/линк на venue — это поле админа (`venue.google_maps_url`), оно рендерится отдельной кнопкой `[Open map ↗]` на странице матча.

**На фронтенде:**
- Char counter + disable submit при превышении лимита (UX).
- Backend — единственный источник правды: frontend-лимиты дублируют серверную логику для удобства, не вместо неё.

### CSRF / same-origin

**Все mutating endpoints** (`POST`, `PATCH`, `DELETE` под `/api/*`, кроме `/api/auth/*` который покрыт Auth.js) проверяют один из:
1. Auth.js CSRF token (для классических form submissions — у нас почти нет, но поддерживается).
2. **Same-origin check** — заголовок `Origin` или `Sec-Fetch-Site: same-origin`. Auth.js v5 сессия живёт в http-only secure cookie `SameSite=Lax` — это уже отбивает cross-site `POST` из браузера (cookie не отправится). Серверный backstop: middleware на `/api/*` сверяет `Origin` с **`ALLOWED_ORIGINS` env-переменной** (CSV-список). Prod: `plusonefc.app`. Staging/dev: соответствующие домены (например, `staging.plusonefc.app`, `localhost:3000`). `Origin: null` (same-origin fetch без header) — допустим. Несовпадение → `403 csrf_check_failed`.

`/api/auth/*` (Auth.js callbacks) защищён встроенным state-param и nonce — отдельных проверок не делаем.

`GET`-эндпоинты CSRF-проверке не подлежат (по определению — нет состояния, которое можно изменить).

> **Почему не CSRF-token на каждый mutating fetch.** SameSite=Lax + Origin check закрывают 99% реальных CSRF-векторов и не требуют распыления токенов по фронтенду (форм у нас почти нет, всё через fetch с session cookie). Если по фидбеку обнаружится дыра — добавим double-submit cookie pattern; в v1 не делаем.

### Rate limiting

Все mutating endpoints применяют per-user rate limit (бакеты в Redis / Postgres advisory-counters — implementation detail). Цель — не безопасность (харасс закрывается `/admin/users → [Ban]`), а защита от случайных бот-петель и спам-кликов. Защита от спама в продуктовом смысле (повторные заявки, спам в чат) живёт в правилах flow выше.

| Endpoint | Лимит | Окно | На что |
|---|---|---|---|
| `POST /api/matches/:id/messages` | 10 | 1 минута | Per (user, match) — нельзя зафлудить один чат |
| `POST /api/reports` | 10 | 24 часа | Per user — суммарно матчи + игроки. Backend и так дедуплицирует повторные жалобы на тот же объект (см. "Модалка отправки" в [personal.md](./pitchup-spec-personal.md)); лимит закрывает спам по разным объектам |
| `POST /api/matches/:id/join` | 5 | 1 час | Per (user, match) — закрывает loop Join → Cancel-request → Join (нельзя «спамить пингом капитана» из pending-секции даже без апрува, см. "Reject / Kick / Leave flows" в [match.md](./pitchup-spec-match.md)) |
| `POST /api/matches/:id/watch` | 5 | 1 час | Per (user, match) — закрывает Notify-me / Stop-watching пинг-понг |
| `POST /api/matches` | 10 | 24 часа | Per user — создание матчей |
| `POST /api/matches/:id/likes` | 30 | 1 минута | Per user — bulk-лайки в модалке (30 за минуту достаточно для ростера 22+; backend и так идемпотентен через UNIQUE) |
| `DELETE /api/me` | 1 | 5 минут | Per user — защита от случайного двойного клика и от автоматизированного абуза захваченного аккаунта (один компрометирующий клик не должен мгновенно сжечь все апелляции через ban-unban-delete loop) |

**Что НЕ rate-limit'ится в v1:**
- `POST /approve`, `POST /reject`, `POST /kick`, `POST /cancel` (captain-only, доверяем — если капитан спамит — он же ломает свой матч)
- `DELETE /join`, `DELETE /watch` (idempotent, ничего не создают)
- `PATCH /me`, `PATCH /matches/:id` (юзер один сам себе вредит, не критично)
- `POST /api/auth/*` (Auth.js встроенно лимитит OAuth-callbacks)

**Ответ при превышении:** `429 rate_limited` + заголовок `Retry-After: <seconds>`. Frontend: toast `"You're going too fast. Try again in a minute."` Кнопка действия не блокируется навсегда — следующий тап через `Retry-After` секунд проходит.

### Cover venue
У каждого venue есть **cover** — предзаготовленная иллюстрация (gradient + иконка), не реальное фото. Это сильно упрощает админку: не нужно файл-хранилище, нет вопросов авторских прав, всё сразу выглядит прилично.

- В коде лежит палитра из **~10-12 ковер'ов** (SVG / CSS-gradient + иконка футбол/мяч/стадион/...). Каждый имеет id (slug).
- В модели venue — поле `cover_id` (`VARCHAR(40)`, **не Postgres enum** — валидация принадлежности к палитре делается на app-уровне, чтобы добавление нового ковера не требовало миграции БД). При добавлении venue в `/admin/venues` админ выбирает один из палитры. **Дефолт — детерминированно по `venue.id` (uuid)** по явной формуле:

```js
cover_id = covers[parseInt(venue.id.replaceAll('-', '').slice(0, 8), 16) % covers.length]
```

Это гарантирует: (1) один и тот же стадион всегда с одним и тем же ковером (стабильность UI), (2) распределение приблизительно равномерное по палитре (первые 8 hex-символов uuid'а — высокоэнтропийная случайность), (3) формула чистая и воспроизводима в любом окружении (frontend / backend / SQL view) без дополнительной таблицы соответствий.
- Используется в:
  - Hero на `/matches/:id` (16:9, full-width)
  - MatchCard (80×80 rounded, мини-версия)
- Тот же `cover_id` используется и для hero, и для card — рендер на frontend.
- **`Match.cover_id` — snapshot `venue.cover_id` на момент INSERT матча** (денормализация, не JOIN на read). При смене `venue.cover_id` в `/admin/venues` уже созданные матчи **не обновляются** — у прошедших и будущих матчей картинка остаётся та, с которой их создавал капитан. Причины: (1) история не переписывается задним числом; (2) капитан создавал матч с конкретным визуалом, неожиданная смена обложки сбивает узнаваемость в чате/превью/MatchCard; (3) на странице матча `cover_id` берётся прямо из `Match`, на одно поле меньше зависит от свежести venue row (хотя `venue` всё равно JOIN'ится за `name`/`address`). Логика INSERT: `Match.cover_id := (SELECT cover_id FROM venue WHERE id = $venue_id)` в той же транзакции что и создание матча — поле NOT NULL, без fallback (если venue без cover_id — это инвариант, нарушенный в `/admin/venues`, валим INSERT с явной ошибкой).

---

## Карта сайта

> **Легенда:** в секции **GUEST-READABLE** гость читает страницу, но любая action-кнопка (Join, Chat send, Report) — disabled со словом `[Sign in to ...]`, тап → `/login?callbackUrl=<откуда>`. Подробнее см. "Доступ гостя" выше.

```
PUBLIC (полностью открыто)
├── /                          → Landing
├── /login                     → Google OAuth
└── /legal/{terms,privacy}

GUEST-READABLE (гость читает, actions → /login?callbackUrl=…)
├── /games                     → список матчей (бывший /discover list view)
├── /map                       → карта матчей (бывший /discover map view)
├── /matches/:id               → страница матча (Chat read-only, CTA disabled)
└── /users/:id                 → публичный профиль игрока

AUTH-ONLY (без логина → /login?callbackUrl=…)
├── /my-matches                → главная: likes + captain + upcoming + past
│                                одним скроллом, без под-табов
├── /chats                     → список чатов матчей (accepted/captain), unread dots
├── /matches/new               → создание матча (wizard 3 шага)
├── /matches/:id/edit          → редактирование (только капитан/админ)
└── /me                        → профиль + настройки + legal + sign out + delete account
                                  (всё на одной странице, отдельной /me/settings нет)

ONBOARDING (one-shot после первого логина)
└── /welcome                   → guard в обе стороны (см. "Guard онбординга"):
                                  • user row есть в БД → редирект на /my-matches
                                  • user row нет + попытка открыть любую
                                    другую страницу → редирект на /welcome
    └── Один шаг: confirm имени и аватара (pre-filled из Google,
                   имя редактируемое, аватар read-only)

ADMIN (is_admin=true; /admin → редирект на /admin/users)
                                 не-admin (is_admin=false) → silent редирект на /my-matches
                                   (без 403-страницы — не светим существование админки)
                                 гость → /login?callbackUrl=/admin → после OAuth
                                   если не admin → /my-matches
└── /admin
    ├── /admin/users           → управление пользователями
    ├── /admin/matches         → модерация матчей
    ├── /admin/venues          → справочник стадионов (CRUD)
    └── /admin/reports         → жалобы на матчи и игроков

LEGACY REDIRECTS (308 Permanent Redirect — для старых ссылок из писем/чатов/закладок)
├── /home          → /my-matches
├── /discover      → /games
├── /discover?view=map → /map
└── /me/settings   → /me
```

---

## Entry-страницы

### `/` — Landing

**Цель:** убедить зайти и зарегистрироваться.

**Блоки сверху вниз:**
1. **Hero:** заголовок "Pickup football in Prague." + подзаголовок "Create a match, fill the spots, play tonight." + кнопки `[Sign in with Google]` (primary) и `[Browse matches →]` (ghost/secondary, под основной) — даёт гостю войти в продукт без логина
2. **3 карточки:** "Create a match" / "Join a match" / "Play tonight" — иконка + 1 строка описания
3. **Футер:** ссылки Terms · Privacy · контакт

**Кнопки:**
| Элемент | Действие |
|---|---|
| Sign in with Google | → /login → Google OAuth → /welcome или /my-matches |
| Browse matches | → /games (как гость) |
| Terms / Privacy | → /legal/terms · /legal/privacy |

**Состояния:**
- Если уже залогинен → редирект на /my-matches

**OG meta tags** (для шеринга самого сайта в чатах):
- `<title>`: `"PITCHUP — Pickup football in Prague"`
- `<meta name="description">`: `"Create a match, fill the spots, play tonight."`
- `<meta property="og:title">`: `"PITCHUP — Pickup football in Prague"`
- `<meta property="og:description">`: `"Create a match, fill the spots, play tonight."`
- `<meta property="og:url">`: `https://plusonefc.app/`
- `<meta property="og:type">`: `"website"`
- `<meta property="og:image">`: `/og/landing.png` (1200×630, тот же бренд-стиль что и `/og/match-default.png`, может быть та же картинка)
- `<meta name="twitter:card">`: `"summary_large_image"`

Эта же базовая пачка тегов — fallback на любом экране где не прописан более конкретный OG (например, `/legal/*`, `/users/:id` без специфики).

---

### `/login`

Auth.js v5 Google OAuth. Страница минимальная — просто кнопка Google. Нет email/пароля.

**Disclaimer под кнопкой Google.** Один блок мелким серым текстом (2 строки), закрывает "параноика, который боится регаться по email":
> *We use Google sign-in, so we never see or store your password — your account stays under your control.*
> *Your email is used only for match notifications (approve, kick, morning reminder). It's never shown to other users or shared. If you lose access — recover through Google.*

Текст статичный, без ссылок (privacy policy линкуется отдельно в footer `/legal/*`). Никаких чекбоксов "I agree" — Google OAuth и его собственный consent screen покрывают legal-сторону.

**Если уже залогинен** → редирект на `callbackUrl` (если есть и прошёл same-origin валидацию Auth.js) или на `/my-matches`. Кнопку Google не показываем.

**Banned state (`?error=banned`).** Когда забаненный юзер прошёл OAuth, backend сбросил сессию и редиректнул сюда (см. "Бан / удаление аккаунта" выше). На этой странице **скрыто всё** — кнопка Google, disclaimer про password, заголовок. Вместо этого — центральный блок:
- Заголовок: "Account banned"
- Тело: "Your PITCHUP account has been banned. If you think this is a mistake, you can appeal — describe the situation and we'll review."
- Кнопка `[Appeal — email us]` primary → `mailto:appeals@plusonefc.app?subject=Account appeal` (открывает почтовый клиент с заполненной темой). На устройствах без default mail-handler линк всё равно работает — почтовик сам обработает. **Apeals в v1 обрабатываются вручную через Google Workspace alias `appeals@plusonefc.app`. Админка для апелляций (очередь, статусы, ответы из UI) — не в v1**, см. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md).
- Никаких других путей: ни кнопки Google, ни линка на `/games` гостем, ни ссылок на `/legal/*` в видимой части. Footer (Terms / Privacy) — оставляем, это юридически обязательная навигация и не даёт обхода (legal-страницы read-only). TopBar — без `[Sign in]`, только лого, тап по лого ничего не делает (или ведёт на `/` лендинг — оттуда снова `[Sign in with Google]` → снова banned → снова сюда). По сути, banned-юзеру некуда идти кроме апелляции.
- Реализация: страница `/login` смотрит `searchParams.get('error')` — если `'banned'`, рендерит **только** banned-блок (early return из компонента). Остальной контент `/login` не рендерится вообще, не просто скрыт CSS'ом.

**Other error states.** Auth.js v5 при ошибках OAuth-flow редиректит на `/login?error=<value>`. Полный список значений — в документации Auth.js, но в продуктовом UI мы маппим их в две группы:

| `?error=` | Когда | Что показываем |
|---|---|---|
| `banned` | Свой backend сбрасывает сессию для забаненного юзера (см. "Бан / удаление аккаунта" выше) | Banned-экран (полностью заменяет страницу, см. "Banned state" выше) |
| `AccessDenied` | Юзер закрыл Google consent screen / отказался дать пермишены / OAuth-провайдер вернул отказ | Нейтральный голубой alert над кнопкой Google: **"Sign-in cancelled. Try again when you're ready."** Никакой паники — юзер сам отменил, это норма. |
| `OAuthSignin` / `OAuthCallback` / `Callback` / `Verification` / `Configuration` / любое другое | Реальная техническая ошибка (упал OAuth-callback, проблемы с провайдером, кривая конфигурация) | Жёлтый alert над кнопкой: **"Sign-in failed. Try again."** Без подробностей — детали в server-логах, юзеру они не помогут. |
| значение не из списка выше и не `banned` | Auth.js обновился и завёл новый код | Тот же жёлтый "Sign-in failed. Try again." (fallback) |

Во всех вариантах кроме `banned` — **кнопка Google остаётся активной**, юзер может ретраить тут же на этой странице. Alert закрывается крестиком (`×` в правом углу alert'а) или автоматически при следующем тапе на Google. На реализацию: на странице `/login` смотрим `searchParams.get('error')`, ветка `'banned'` рендерит banned-экран early-return'ом (см. "Banned state" выше), все остальные значения проходят через mapping выше и рендерят alert + обычную страницу с кнопкой Google.

---

### `/welcome` — Онбординг (1 шаг)

Показывается только один раз — после первого входа через Google. Защищён двусторонним middleware-гвардом (см. "Guard онбординга" выше): завершившие сюда не попадают, незавершившие — не выходят отсюда никуда кроме `/legal/*` и `/api/auth/*`.

**TopBar:** лого слева, ghost-ссылка `Sign out` справа (вместо 🔔). Закрывает кейс "залогинился, передумал, хочу выйти". Тап → стандартный Auth.js sign-out (`/api/auth/signout`, в allowlist'е middleware). **Никакого DELETE из БД** — на этом этапе user row ещё не создана (она создаётся только при `[Get started →]`), удалять нечего. OAuth-сессия очищается, юзер выходит на `/login` / `/`. При следующем входе через Google — снова `/welcome` с pre-filled данными из Google OAuth payload.

**BottomNav:** **скрыт на `/welcome` целиком.** Юзер не прошёл онбординг — таб-навигация бессмысленна: тапы в BottomNav вызвали бы редиректы обратно на `/welcome` через middleware-guard. Единственные выходы с этой страницы — `[Get started →]` или `Sign out` в TopBar.

**Контент — один экран, confirm имени и аватара:**
- Заголовок "Welcome to PITCHUP".
- Аватар (preview из Google, read-only в v1 — своя загрузка фото не делается, нет файл-хранилища; см. "Что НЕ делаем в v1" в [personal.md](./pitchup-spec-personal.md)).
- Поле имени (pre-filled из Google, редактируемое; на случай "не хочу светить full-name из Google-аккаунта" — можно поправить).
- Кнопка `[Get started →]` primary.
- Подпись внизу мелким серым текстом (две строки):
  > *You can change your name and contact info later in your profile.*
  > *Your email stays private — used only for match notifications, never shown to others. We don't store your password (Google handles login).*

**После тапа `[Get started →]`:**
- Backend: `INSERT INTO users (google_sub, email, name, avatar_url, contact_info, email_notifications, is_admin, banned) VALUES (?, ?, ?, ?, NULL, true, false, false)`. Это **первая и единственная** запись юзера в БД — до этого момента его в `users` нет (см. "Guard онбординга" выше). Схема: `users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (id генерится автоматически), `users.google_sub TEXT UNIQUE NOT NULL` — uniqueness гарантирует БД, не приложение. Промоут до админа — только через `/admin/users → [Promote to admin]` существующим админом; первый админ ставится вручную в БД (см. "Bootstrap первого админа" ниже).
- **Race с параллельной вкладкой** (юзер открыл `/welcome` в двух вкладках и тапнул `[Get started →]` почти одновременно): INSERT выполняется как `INSERT INTO users (...) VALUES (...) ON CONFLICT (google_sub) DO NOTHING RETURNING id`. Если RETURNING пустой (другая вкладка успела первой) — делаем fallback `SELECT id FROM users WHERE google_sub = ?` и идём по success-пути с найденным id. UNIQUE-индекс по `google_sub` — единственная защита от двойной row; никаких advisory-locks.
- Фронтенд: после успешного INSERT — `router.push(callbackUrl ?? '/my-matches')`. **Никакого `Auth.js update()`** не нужно: middleware на следующем request делает свой обычный SELECT и видит свежесозданную user row.
- Редирект:
  - Если URL содержал `?callbackUrl=<path>` и path прошёл same-origin валидацию → редирект на `callbackUrl`
  - Иначе → `/my-matches`
- **Если INSERT упал** (DB / network error / unique constraint race с параллельной вкладкой) → юзер остаётся на экране, toast "Something went wrong. Try again." Кнопка `[Get started →]` снова активна. На unique-constraint конкретно (двойной submit) — backend ловит ошибку, отдаёт 200 (idempotent), фронт идёт по success-пути. Никаких отдельных экранов ошибок.

> **Reload state.** Перезагрузка вкладки на `/welcome` = тот же экран, имя/аватар pre-filled **из Google OAuth payload** (`session.user.name`, `session.user.image` — Auth.js v5 кладёт их туда из последнего успешного OAuth). Если юзер успел поправить имя в инпуте до reload — изменения теряются (нигде не сохраняли). Принимаем — онбординг один экран, перезаполнить не больно. Для `/matches/new`: то же правило — перезагрузка вкладки = старт с шага 1, всё с нуля. Если будет жалобы — введём localStorage-draft. См. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md).

---

## Глобальные компоненты

### TopBar (authenticated)
Лого слева, 🔔 справа. Red dot если есть непрочитанные. Тап → панель Updates (см. "Уведомления" выше). Аватара в TopBar нет. Свой профиль — через BottomNav `Me`. **Шестерёнки settings больше нет** — все настройки и Sign out / Delete account живут пунктами меню на странице `/me` (см. [personal.md](./pitchup-spec-personal.md)).

### TopBar (guest)
Лого слева, `[Sign in]` кнопка справа. Тап на лого → `/games` (не на лендинг — гость уже зашёл, на лендинг ему возвращаться незачем; исключение: на `/` лого ведёт на `/`, чтобы не было `current = target`). Используется на `/`, `/games`, `/map`, `/matches/:id`, `/users/:id`, `/legal/*` для незалогиненных пользователей. BottomNav для гостей показывается с теми же 5 табами что и для залогиненных, но `My matches`, `Chats` и `Me` помечены **disabled** (серая иконка, тап → `/login?callbackUrl=<этот таб>`). Это даёт гостю видеть структуру приложения и приглашает залогиниться, а не прятать половину UI.

> **Naming.** В BottomNav таб #5 называется `Me` (как в TopBar guest списке disabled-табов выше и в навигационной карте в [app-map.md](./pitchup-app-map.md)). Слово "Profile" в спеке используется только для контента **внутри** `/me` ("View public profile" row, "превью профиля" в описаниях) и для публичной страницы `/users/:id` — не для самого таба.

### BottomNav (sticky)
**5 табов, pill-стиль активного:**

| # | Таб | URL | Label на pill | Кому |
|---|---|---|---|---|
| 1 | My matches | `/my-matches` | "My matches" | auth-only (для гостя — disabled) |
| 2 | Games | `/games` | "Games" | guest + auth |
| 3 | Map | `/map` | "Map" | guest + auth |
| 4 | Chats | `/chats` | "Chats" | auth-only (для гостя — disabled) |
| 5 | Me | `/me` | "Me" | auth-only (для гостя — disabled) |

**Таб 5 — Me:** не просто профиль, а совмещённый экран: превью своего профиля (аватар, имя) + блок настроек (Notifications, Sign out, Delete account). По сути заменяет отдельную страницу настроек — всё в одном месте.

**Pill-стиль:** неактивный таб — только иконка нейтрального цвета (без подписи). Активный таб — тёмная капсула (pill) с белой иконкой + текстовым label внутри. Капсула шире обычной иконки, неактивные сжимаются, чтобы всё уместилось. Это сознательное UI-решение (референс взят с конкурентов с 5-табовой нав) — экономит вертикальное место, делает активный таб явно выделенным, label на нём не дублируется в TopBar.

**Создать новый матч:** обычная кнопка `[+ New match]` в верхней панели на `/games` и `/map` (рядом с searchbar). **Floating FAB убран** — кнопка в top bar менее заметна на маленьких экранах, но и не закрывает контент.

**Captain workspace:** доступен через `/my-matches → Section Captain` (показывается только если есть организованные матчи). Отдельного таба для капитана нет.

**Desktop:** BottomNav привязан к низу центрального контейнера 480px (см. "Viewport" выше), не к низу viewport'а.

### MatchCard (горизонтальная)

Минималистичный текстовый формат — без cover-картинки.

```
┌─────────────────────────────────────────┐
│  [role-бейдж если есть]                 │
│  Venue name, District                   │
│  Tue 27 May · 19:00                     │
│                                         │
│  👤 7 a side by Mark H.      [9/14]     │
│                                         │
│                               Free      │
└─────────────────────────────────────────┘
```

**Строки карточки:**
- **Venue name + район** (жирный заголовок)
- **Дата + время** (`Tue 27 May · 19:00`)
- **Строка капитана:** аватар (24px) + `N a side by <captain short name>` слева (например "by Mark H." — first name + инициал фамилии, чтобы влезать в строку; никаких `@handle` — username в системе нет, см. "Уникальный логин / username" выше), счётчик слотов `[X/Y]` справа. Счётчик: зелёный → почти full → красный если full. **Stub'ы из `captain_crew` включены в "accepted" для счётчика** — `9/10` где 9 = 1 капитан + 8 stub'ов работает естественно. **N a side:** `N = Math.floor(total_spots / 2)`, минимум 1. Пример: total=14 → 7 a side, total=13 → 6 a side, total=9 → 4 a side.
- **Цена / "Free"** — правый нижний угол

**Что убрано с карточки** (осознанно, фиксируем):
- Cover venue — нет (только на странице матча)
- Surface иконка + studs-бейдж — нет (на странице матча в Tab Details)
- `✓ Booked` / `⚠ Gathering` — нет (на странице матча)
- Теги — нет в v1

**Опциональный role-бейдж** (верхняя строка карточки, только в контекстах где нужен статус):
- `Captain` — в `/my-matches → Section Past` и `/my-matches → Section Captain`, в `/chats`
- `You're in ✓` (зелёный) — в `/my-matches → Section Upcoming` для accepted
- `Waiting…` (серый, 50% opacity) — в `/my-matches → Section Upcoming` для pending
- `👀 Watching` (микро) — в `/my-matches → Section Upcoming` для watching
- В `/games` и `/map` role-бейдж не показывается (там контекст — поиск, не "мои")

**Мини-ростер аватарок** (только в укрупнённой "Your next match" в `/my-matches`, см. [personal.md](./pitchup-spec-personal.md)):
- Стек из 5 кружков-аватаров, накладывающихся внахлёст слева направо.
- Порядок: капитан → реальные accepted (по дате принятия) → stub'ы из `captain_crew` (по порядку создания).
- Stub'ы рендерятся как серые силуэт-аватары (без имени, имя видно только в Tab Lineup).
- Если accepted+crew > 5 — последний кружок заменяется на `+N` бейдж.
- Под стеком — строка: `"Mark H., Pavel, Tomas and 11 more are attending"` — реальные юзеры по короткому имени (first name + инициал фамилии при коллизии в пределах матча, иначе просто first name; никаких `@handle` — username в системе нет), stub'ы — по first name из `captain_crew`. Порядок тот же. Truncate после 3 имён.

Состояния карточки: Open / Almost full / Full / You're in / Cancelled

### PlayerChip
- Аватар 40px + имя
- Тап на chip → `/users/:id` (профиль игрока). Гость тоже может тапнуть — профили публичны
- Состояние pending: чип в 50% opacity. Принятый — в полном цвете.
- **Stub-вариант** (для stub player'ов из `captain_crew`, см. "Тип матча" → терминология): серый силуэт-аватар + только first name, 50% opacity, **не кликабелен**. Long-press / hover → tooltip `"Not on app yet"`. Используется только в Tab Lineup и в мини-ростерах MatchCard.

### Loading state
- Все экраны со списками показывают **skeleton placeholders** во время загрузки (карточки матчей, ростер игроков, таблицы admin)
- Skeleton имитирует структуру (аватар-круг, текстовые полоски), не спиннер

### Error / empty pages
- **Match not found** (404 по `/matches/:id` с неизвестным id) → "This match doesn't exist or was deleted. [Back to Games]"
- **Match cancelled** — отдельной error-страницы нет. Открывается обычная `/matches/:id` с баннером "Match cancelled · [причина]". CTA bar полностью disabled.
- **403 Forbidden** (попытка открыть `/matches/:id/edit` не капитаном) → "Only the organizer can edit this match. [View match →]"
- **Network error** (любой fetch упал) → toast "Couldn't load. [Retry]"

### Legal pages (`/legal/terms`, `/legal/privacy`)
- Статический markdown, без интерактива. Один экран — заголовок + содержимое + футер. Доступны всем без логина.
