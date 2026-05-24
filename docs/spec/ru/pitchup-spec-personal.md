# PITCHUP — Спека: личные экраны и админка

> Часть спеки. Карта всех файлов — [INDEX](./pitchup-spec-INDEX.md).
> ⚠ **После правки этого файла** — пройди audit-checklist в шапке [pitchup-app-map.md](./pitchup-app-map.md) и синхронно обнови карту, если затронуты пункты чек-листа (стек, нав, TopBar, login, PWA, cron, lifecycle, сущности).
> Здесь: `/my-matches`, `/chats`, `/me`, `/users/:id`, `/admin/*` (users / matches / venues / reports), известные пробелы, что НЕ делаем в v1.

---

## `/my-matches` — Главная (залогинен)

Единая сводная страница "всё про мои матчи". Один скролл, без под-табов и chip-фильтров. Секции с текстовыми разделителями, пустые секции не рендерятся.

**Layout (сверху вниз):**
1. **TopBar** (лого + 🔔). Никакого greeting "Hello, [Name]" — личность юзера и так понятна из контекста.
2. **Section: Likes reminder** (если есть недавно завершившийся матч, ожидающий лайков):
   - Карточка-баннер с непоставленными лайками. **Вычисляется on-read** при SSR `/my-matches`: SELECT матчей где юзер был `captain` или `accepted`, статус Ended (`now() >= start_time + duration`), и юзер ещё **не поставил ни одного лайка** в этом матче (`NOT EXISTS (Like WHERE match_id=? AND giver_id=?)`). Никакого SSE-эвента нет — статус матча сам по себе on-read, эмитить переход в Ended некому. Если юзер уже на открытой `/my-matches` и его матч переходит в Ended за время сессии — карточка появится после reload / pull-to-refresh (известное упрощение MVP).
     - **1 матч:** `"1 match awaits your likes · [Open]"` — тап ведёт на этот `/matches/:id`.
     - **2+ матча:** `"N matches await your likes · [Open]"` — тап скроллит в `/my-matches → Section Past`, где у каждой такой карточки появляется собственный мини-бейдж `Awaiting likes`. Лайки ставятся per-match — никаких bulk-флоу.
     - На странице матча CTA `[Like teammates]` видна внизу — юзер тапает сам. Авто-открытие лайк-модалки по URL-параметру — см. "Известные пробелы" ниже.
3. **Section: Captain** (если есть upcoming или InProgress матчи где юзер капитан):
   - `MatchCard` с бейджем `Captain` + бейджем `N pending` (оранжевый, если есть pending-заявки) + кнопкой `[Manage →]` справа в карточке → `/matches/:id?sheet=captain`. URL-параметр `?sheet=captain` сигнализирует странице матча авто-открыть captain sheet при загрузке. Если pending = 0 — кнопка всё равно ведёт с тем же параметром (captain sheet открывается, просто список pending пустой).
   - Для **InProgress** матчей кнопка `[Manage →]` заменяется на `[View →]` → `/matches/:id` (captain sheet недоступен после старта; `[🎲 Shuffle teams]` по-прежнему доступен из Tab Lineup). Бейдж `N pending` скрывается (pending уже авто-реджектнуты).
   - Сортировка по `start_time` ASC.
4. **Section: Upcoming** (accepted / pending / watching — смешанно):
   - **Первая карточка** — укрупнённый MatchCard в стиле "Your next match": название venue, дата/время, **countdown если < 24ч**, мини-ростер аватарок, кнопка `[View match →]`. Это переехавший контент бывшей `/home → Your next match`.
   - Остальные карточки — обычные `MatchCard` со state-бейджами: `You're in ✓` (зелёный, accepted), `Waiting…` (серый, 50% opacity, pending), `👀 Watching` (микро-бейдж, watching).
   - **InProgress матчи:** карточка остаётся в Section Upcoming (не уходит в Past) — accepted-игрок всё ещё "в матче". Таймер/счётчик заменяется на значок `🔴 In progress` (тот же что на странице матча). **Pending:** к моменту InProgress уже авто-реджектнуты кроном — уходят в Section Past. **Watching:** `👀 Watching` карточка **исчезает** из Upcoming когда матч переходит в InProgress (Watch-запись остаётся в БД, но Section Upcoming не показывает watching-карточки для матчей со статусом InProgress — матч начался, ждать слота бессмысленно).
   - Сортировка по `start_time` ASC. Бейдж заменяет старые chip-фильтры — фильтра нет, всё в одной ленте.
5. **Section: Past** (history):
   - Показываем **ВСЕ** матчи где user имел `JoinRequest.status ∈ {accepted, left, kicked, rejected (с auto_reason=match_started|match_cancelled), cancelled}` ИЛИ был капитаном, при условии что `match.status ∈ {Ended, Cancelled}`. Также watching-карточки (Watch-запись существует на момент Ended — матч завершился полным).
   - **Sub-label на карточке** (зависит от исторической роли юзера в матче):
     - `accepted` + Ended → "Played"
     - `accepted` + Cancelled → "Match was cancelled" (JoinRequest.status остаётся `accepted` при cancel — см. "my_status mapping" в [global.md](./pitchup-spec-global.md))
     - `left` → "You left" (+ reason если был сохранён)
     - `kicked` → "You were removed"
     - `rejected` (manual) → "Request declined"
     - `rejected` (auto_reason=`match_started`) → "Request expired"
     - `rejected` (auto_reason=`match_cancelled`) → "Match was cancelled"
     - `cancelled` (user cancelled own pending) → "You cancelled your request"
   - Сортировка `start_time` DESC. Лимит первого рендера — 20 карточек, дальше `[Show more]` догружает следующую страницу.
   - На карточках где юзер был капитаном — мини-бейдж `Captain`. Watching-карточки в Past без role-бейджа.
   - **Like reminder** появляется только для `status=accepted` + match Ended (см. Section Likes reminder выше).
6. **BottomNav** (sticky).

**Empty state** (всё пусто — нет captain, upcoming, past):
- Иллюстрация + "No matches yet."
- Две CTA в столбик: `[Find a match →]` (primary, → /games) и `[+ New match]` (ghost, → /matches/new).

**Кнопки:**
| Элемент | Действие |
|---|---|
| TopBar 🔔 | панель Updates |
| MatchCard | → /matches/:id |
| `[Manage →]` в Captain карточке (Open/Full) | → `/matches/:id?sheet=captain` (captain sheet открывается всегда; если pending=0 — sheet пустой) |
| `[View →]` в Captain карточке (InProgress) | → `/matches/:id` (без `?sheet=captain` — sheet недоступен) |
| Likes reminder `[Open]` | → /matches/:id (Tab Lineup) |
| `[Show more]` в Past | догружает next 20 карточек |
| `[Find a match →]` (empty) | → /games |
| `[+ New match]` (empty) | → /matches/new |

**Состояния:**
- **Loading:** skeleton cards (по 3-4 на каждую видимую секцию).
- **Empty state** — см. выше.
- **Нет матчей в базе (0 матчей в системе):** для нового юзера это эквивалентно empty state — показываем те же два CTA. Отдельно "Be the first →" не делаем.

**Real-time:** подписывается на глобальный SSE-канал `/api/updates/stream` (см. "Real-time sync" в [global.md](./pitchup-spec-global.md)). События которые ре-рендерят страницу:
- `my_match_changed` — пересчёт секций (Captain / Upcoming / Past) и порядка карточек.

**Pending окно ≤5 мин:** pending-карточка для матча с `now() >= start_time` показывается с бейджем `Waiting…` до auto-reject'а (окно ≤5 мин — interval кронa). Допускаем — это редкое окно.

**Переходы Open→InProgress→Ended без real-time:** вычисляются on-read, real-time SSE не эмитится (нет cron'а для перехода между статусами матча — см. app-map.md). Карточки в Section Upcoming могут показывать stale статус до reload — приемлемо: countdown тикает на клиенте независимо, при следующем SSR пересчитается.

**Секция Likes reminder** не реактивна — вычисляется on-read при каждом SSR `/my-matches`. См. описание секции выше.

**Гость:** контент `/my-matches` — auth-only. Иконка таба в BottomNav disabled, тап → `/login?callbackUrl=/my-matches`. Прямой заход на URL гостем → `/login?callbackUrl=/my-matches`.

---

## `/chats` — Чаты матчей

Таб-аггрегатор всех чатов матчей в которых юзер участник (accepted) или капитан. UX-кузен `/games`: список MatchCard'ов, тап → `/matches/:id`. Личных сообщений (DM 1-1) **нет в v1** — только чаты привязанные к матчам.

**Layout (сверху вниз):**
1. **TopBar:** стандартный (лого + 🔔). Без `[Filters]`, без searchbar — список ограничен своими матчами, не сотнями.
2. **Список MatchCard'ов:**
   - Фильтр: матчи где юзер `accepted` или `captain`. Watching и pending **не входят** — у них нет доступа к чату.
   - **Past матчи включаем** — у них чат не запирается после Ended (см. правила чата в [match.md](./pitchup-spec-match.md)).
   - **Сортировка:** по timestamp последнего сообщения в чате (DESC). Матчи без сообщений уходят вниз и сортируются по `start_time` ASC между собой. Цель — освежить активные чаты, даже past-матчей. Свежий Open без сообщений всё равно ниже past-матча с активным чатом — приемлемо, т.к. он есть в Section Upcoming `/my-matches`.
   - **Карточка:** стандартный `MatchCard` + **unread dot** в углу карточки (если есть непрочитанные сообщения этого чата для данного юзера). Без preview последнего сообщения в v1 (Telegram-стиль можно в v1.1).
3. **BottomNav** (sticky).

**Кнопки:**
| Элемент | Действие |
|---|---|
| MatchCard | → `/matches/:id?tab=chat` — открывается сразу на Tab Chat (см. "Deep-link `?tab=chat`" в [match.md](./pitchup-spec-match.md)). Юзер может переключиться на Lineup тапом по Tab bar — кнопка всегда там. |
| TopBar 🔔 | панель Updates |

**Состояния:**
- **Loading:** 4-6 skeleton cards.
- **Empty state** (нет матчей с доступом к чату): "No conversations yet. Join a match to start chatting." + `[Find a match →]` (→ /games).

**Real-time:** подписка на глобальный SSE `/api/updates/stream`. События:
- `chat_message_received: { match_id, ts }` — карточка матча поднимается наверх списка, ставится unread dot. Если юзер прямо сейчас на `/matches/:match_id` с активным Tab Chat — событие игнорируется (per-match SSE уже показал сообщение).
- `chat_read_sync: { match_id }` — multi-tab consistency: открыл чат в одной вкладке, прочитал — unread dot гаснет во всех вкладках.
- `my_match_changed` — если юзер только что accepted в новый матч / kicked из текущего — список пересинхронизируется (карточка добавляется/убирается).

**Unread chat dots — модель данных.** Источник правды — таблица `ChatRead(match_id, user_id, last_read_at)` с composite PK (см. ERD в [app-map.md](./pitchup-app-map.md)). Одна строка на пару (юзер, матч); создаётся лениво при первом открытии Tab Chat.

- **Есть ли unread:** `EXISTS (ChatMessage WHERE match_id=? AND created_at > ChatRead.last_read_at AND deleted_at IS NULL AND author_id != ?)` для данного юзера. Свои сообщения unread не считаем. Если строки `ChatRead` нет вообще — unread = все сообщения чата (после первого захода Tab Chat она сразу появится).
- **Mark-as-read:** когда юзер открывает Tab Chat на `/matches/:id` — backend делает `UPSERT ChatRead(match_id, user_id, last_read_at = now())`. Это **единственный** триггер mark-as-read; ни scroll position, ни видимость отдельных bubble'ов не учитываем (упрощение MVP).
- **`chat_read_sync` SSE event** эмитится после UPSERT для всех вкладок юзера — unread dot на карточке матча в `/chats` гаснет везде. Подписан глобальный `/api/updates/stream` (см. "Real-time sync" в [global.md](./pitchup-spec-global.md)).
- **Удаление сообщений капитаном** (soft-delete через `deleted_at`) — сообщение исчезает из выборки unread автоматически (фильтр `deleted_at IS NULL`). Если юзер не читал чат, капитан удалил последнее сообщение и больше ничего не пришло — dot гаснет на следующем рендере `/chats` сам.

**Гость:** контент `/chats` — auth-only. Иконка таба в BottomNav **disabled** (серая), тап → `/login?callbackUrl=/chats`. Прямой заход гостем → `/login?callbackUrl=/chats`.

**Out of scope v1** (зафиксировано в "Известные пробелы" ниже):
- DM 1-1 между игроками — нет, общение только в контексте конкретного матча.
- Поиск по чатам.
- Preview последнего сообщения на карточке.
- Mention-нотификации (@username).
- Inbox folders / категории (Active / Archived) — у нас один плоский список.

---

## `/me` — Профиль + настройки (одна страница)

Объединённая страница: бывшие `/me` (профиль + tabs Upcoming/History) и `/me/settings` (тогглы + legal + sign out + delete) теперь живут на одном URL. Tabs Upcoming/History **переехали** в отдельный таб `/my-matches`. На `/me` остался только профиль и пункты меню настроек.

**Layout (один скролл сверху вниз):**

1. **TopBar:** стандартный (лого + 🔔). **Без шестерёнки** — она больше не нужна, настройки прямо на этой странице.
2. **Header:**
   - Аватар (большой круг).
   - Имя.
3. **Section "ACCOUNT"** (заголовок маленький uppercase серый):
   - **Edit profile** — row с иконкой ✏️ слева и шевроном `›` справа → bottom-sheet/modal (имя, Contact info; аватар — из Google, не редактируется; `[Save]` / `[Cancel]`).
   - **View public profile** — row с иконкой 👤 → `/users/:user_id` (то что видят другие).
4. **Section "NOTIFICATIONS"**:
   - **Email notifications** — row с иконкой ✉️ + текстовая подпись "We'll email you when you get accepted, removed, or on match day." + **toggle справа** (on/off, default **on**). Управляет approve, kick и morning reminder одновременно. Подробная логика — в "Уведомления" в [global.md](./pitchup-spec-global.md).
   - **Browser notifications** — row с иконкой 🔔 + подпись "Get notified even when the tab is in the background." + toggle (default **off**). **Row скрыт на iOS** — UA содержит `iPhone|iPad|iPod` (все браузеры iOS — Safari/Chrome/Edge/Firefox — внутри на WKWebView, Notification API без PWA там не работает). Первый тап на toggle запускает нативный permission-запрос браузера. Сохраняется в localStorage (настройка браузерная, не аккаунтная). Подробности — в "Browser notifications" в [global.md](./pitchup-spec-global.md).
   - **In-app inbox** (🔔 в TopBar) — **не настраивается, отдельного toggle нет**, работает всегда.
5. **Section "LEGAL"**:
   - **Terms of service** — row с иконкой 📄 → `/legal/terms`.
   - **Privacy policy** — row с иконкой 🔒 → `/legal/privacy`.
6. **Section "ACCOUNT ACTIONS"** (или просто визуально отделено):
   - **Sign out** — row с иконкой `[→`, обычный (не destructive) → logout, редирект на `/`. **Единственный** вход в logout из авторизованной зоны приложения. (Исключение — `/welcome`: пока юзер ещё не завершил онбординг, в TopBar справа стоит ghost-ссылка `Sign out` — это отдельный выход для случая "залогинился, передумал". См. "/welcome — Онбординг" в [global.md](./pitchup-spec-global.md).)
   - **Delete account** — row с иконкой 🗑️, **destructive стиль** (красный текст/иконка) → confirm modal:
     - Если текущий юзер — **единственный незабаненный админ** (`is_admin=true` И `count(is_admin=true, banned=false) === 1`) → блокирующий текст: "You're the only admin. Promote another user to admin first, then you'll be able to delete this account." Кнопка `[Delete account]` **disabled**, доступна только `[Cancel]`. Эта ветка приоритетнее остальных — блокирует, остальные информируют. Серверный backstop: `DELETE /api/me` начинается с того же предиката, что используется в demote/ban (см. "Admin role management & safety" — `target.is_admin === true && count(is_admin=true, banned=false) === 1`). Если предикат истинен → `409 last_admin` с сообщением "Cannot delete the only remaining admin. Promote someone else first." Это источник истины, UI-блокировка — зеркало.
     - Если юзер **капитан** хотя бы одного upcoming матча → "You're the organizer of **N upcoming match(es)**. They will be cancelled and players will be notified. This can't be undone." **N = матчи где user=captain, статус матча ∈ {Open, AlmostFull, Full}, `start_time > now()`. InProgress-матчи в N не входят — они остаются жить как ghost-match** (см. "Ghost-match" в [global.md](./pitchup-spec-global.md)).
     - Если **только участник** (accepted в чужих, но не капитан) → "You're signed up for **N upcoming match(es)**. Your spots will be freed for others. This can't be undone."
     - Если ничего нет → "Your profile and history will be permanently removed. This can't be undone."
     - Кнопки `[Delete account]` destructive / `[Cancel]`. Никаких "type DELETE to confirm".
7. **BottomNav** (sticky).

**Чего на `/me` НЕТ** (фиксируем явно для исключения путаницы):
- ~~Tabs Upcoming/History~~ — переехали в `/my-matches`.
- ~~Chip-row You're in / Waiting / Captain~~ — переехали в `/my-matches → Section Upcoming` (бейджи на карточках).
- ~~Captain workspace с FAB~~ — переехал в `/my-matches → Section Captain`.
- ~~Wallet/Payments~~ — фичи нет в v1.
- ~~Following & Followers~~ — фичи нет.
- ~~Language toggle~~ — UI только EN в v1 (см. "Известные пробелы" ниже).
- ~~Contact Us / Rate App / Code of Conduct~~ — в v1 не делаем.

**Кнопки:**
| Элемент | Действие |
|---|---|
| `Edit profile` | модалка с полями: имя, Contact info (textarea "How to reach me"). Аватар — из Google, не редактируется. `[Save]` / `[Cancel]` |
| `View public profile` | → /users/:user_id |
| Email notifications toggle | сохраняет в DB; immediate effect на следующее уведомление |
| Browser notifications toggle | первый тап — permission запрос; сохранение в localStorage |
| `Terms of service` / `Privacy policy` | → /legal/* |
| `Sign out` | logout → редирект на `/`. Auth.js удаляет session cookie на текущем устройстве — другие устройства/вкладки этого юзера остаются залогиненными (mass-revoke всех jti — "Sign out everywhere" — v1.1, в MVP нет; см. "Аутентификация" в [global.md](./pitchup-spec-global.md)). Гость видит лендинг. |
| `Delete account` | confirm modal → DELETE /api/me → редирект на `/`. Backend в той же транзакции что DELETE — INSERT в `revoked_sessions` для всех jti юзера. Фронт делает sign-out, редирект на `/`. Гость видит лендинг. |

**Гость:** контент `/me` — auth-only. Иконка таба в BottomNav disabled, тап → `/login?callbackUrl=/me`. Прямой заход на URL гостем → `/login?callbackUrl=/me`.

---

## `/users/:id` — Публичный профиль игрока

Доступен всем (включая гостей). Минимальная «карточка человека».

**Блоки:**
1. TopBar (`← Back`)
2. Аватар (большой) + имя
3. Contact info (если заполнен) — текстом, ссылки автоматически кликабельные. Если пусто — секция не показывается
4. Кнопка `[⋯]` справа сверху → dropdown: `Report player`.
   - **Залогинен, чужой профиль** — тап → модалка отправки жалобы (см. "Модалка отправки" в `/admin/reports` ниже).
   - **Гость** — кнопка `[⋯]` видна, `Report player` в меню виден; тап → Sign-in modal (`"Sign in to report this player"`). После логина возврат на страницу, юзер жмёт Report сам.
   - **Свой профиль** — кнопка `[⋯]` скрыта целиком (меню было бы пустым).

**Состояния:**
- Открыл свой `/users/:id` → редирект на `/me`
- User not found → "This user is no longer on PITCHUP. [Back]" — `[Back]` = `router.back()`, fallback на `/games`.
- Забаненный или удалённый пользователь → "This user is no longer on PITCHUP." (унифицированный текст для privacy — не светим причину).

**OG meta tags** (для шеринга профиля в мессенджерах):

| Тег | Значение |
|---|---|
| `<title>` | `"{name} · PITCHUP"` |
| `<meta name="description">` | `"Check out {name}'s profile on PITCHUP."` |
| `<meta property="og:title">` | `"{name} · PITCHUP"` |
| `<meta property="og:description">` | `"Pickup football in Prague."` |
| `<meta property="og:url">` | `https://plusonefc.app/users/{id}` |
| `<meta property="og:image">` | `/og/landing.png` (статик дефолт — аватар Google не хостим) |
| `<meta name="twitter:card">` | `"summary"` |

Для забаненных и удалённых аккаунтов — дефолтные теги лендинга.

---

## `/admin` — Админка (`is_admin=true`, `requireAdmin()`)

**Доступ:**
- `is_admin=true` → нормальный доступ. `/admin` без суффикса → редирект на `/admin/users`.
- `is_admin=false` (залогинен, но не админ) → silent редирект на `/my-matches`. Без 403-страницы — не светим существование админки обычным юзерам.
- Гость (не залогинен) → стандартный `/login?callbackUrl=/admin`. После OAuth — если новый аккаунт `is_admin=false` → /my-matches; если admin (что почти невозможно для нового OAuth-юзера, но формально) → /admin/users.

**Layout:** bottom-tabs с четырьмя пунктами Users / Matches / Venues / Reports (тот же mobile-pattern, см. "Viewport" в [global.md](./pitchup-spec-global.md)). Активный пункт подсвечен.

Все таблицы в админке: при 0 результатов показывают строку "No records yet" (для venues — "[+ Add the first venue]"). Loading — skeleton rows. На узком viewport (480px) таблицы скроллятся горизонтально внутри своего контейнера (`overflow-x: auto`).

### `/admin/users`
- Таблица: аватар / имя / email / joined / admin / status
- Колонка **admin** — `✓` если `is_admin=true`, иначе пусто.
- Поиск по имени/email
- Фильтры: admin (all / yes / no) / status (active/banned)
- Действия на строке:
  - `[Ban]` (для active) или `[Unban]` (для banned)
  - `[Promote to admin]` для `is_admin=false` **или** `[Demote to user]` для `is_admin=true` (toggle, видна одна из двух). Лейблы кнопок остаются в терминах "admin/user" — это UI-копирайт, не имя поля.
  - Клик по строке (вне кнопок) → `/users/:id` в новой вкладке. Отдельного `[View]` нет — он избыточен.
- **Ban** → modal: причина (textarea, обязательное) → `[Confirm ban]`. Бан перманентный. Снимается только админом вручную через `[Unban]`. Последствия — см. "Бан / удаление аккаунта" в [global.md](./pitchup-spec-global.md).
- **Promote / Demote** → confirm-modal с textarea "Reason" (обязательное), кнопка `[Confirm promote]` / `[Confirm demote]`. Симметрично Ban-flow. Reason пишется в audit-лог (см. ниже).

#### Admin role management & safety

**Защита "последнего админа":**
- Серверная проверка перед demote или ban: если `target.is_admin === true` И `count(is_admin=true, banned=false) === 1` → reject с ошибкой `"Cannot demote/ban the last remaining admin"`. Это источник истины.
- UI-зеркало: на единственной admin-строке кнопки `[Demote to user]` и `[Ban]` задизейблены с tooltip `"Last admin — cannot be demoted or banned"`. UX-улучшение, не замена серверной проверке.
- **Self-delete тоже покрыт** — `DELETE /api/me` использует тот же предикат last-admin и отдаёт `409 last_admin`. UI-зеркало — в Section ACCOUNT ACTIONS confirm modal.

**Защита от self-modification:**
- На своей строке (рядом с именем индикатор `(you)`) задизейблены только те кнопки, что в принципе показываются: `[Ban]` и `[Demote to user]` (для своего юзера с `is_admin=true` — `[Promote to admin]` не рендерится вообще, см. правило toggle выше). Tooltip на задизейбленных: `"You cannot modify your own account"`.
- Серверная проверка-backstop: `if (target_id === current_admin_id) → reject "You cannot modify your own account"`. На случай прямого API-вызова в обход UI.
- Чтобы уйти из админов — попросить другого админа (или ручной SQL, если админ один; но тогда система всё равно не даст разжаловать последнего — это by design, см. "Bootstrap первого админа" в [global.md](./pitchup-spec-global.md)).

**Audit-лог:**
- Каждое `promote` / `demote` / `ban` / `unban` пишется в таблицу `admin_actions`: `id, actor_admin_id, target_user_id, action, reason, created_at`.
- В UI v1 лог не показывается — он для апелляций и расследований, читается напрямую из БД. Отдельный экран `/admin/audit` — кандидат на v1.1.

### `/admin/matches`
- Таблица: название / капитан / дата / venue / статус / участников
- Поиск, фильтр по статусу
- Действия: `[Edit]` `[Cancel]` `[Hide text ▾]` `[Delete]`. Клик по строке (вне кнопок) → `/matches/:id` в новой вкладке.
- **Edit** → открывает `/matches/:id/edit` (тот же экран что у капитана). Админ может править те же поля что и капитан — детали см. в [match.md](./pitchup-spec-match.md) (`/matches/:id/edit`). Для In progress / Ended / Cancelled кнопка `[Edit]` disabled (то же ограничение, что у капитана).
- **Cancel** → та же модалка что у капитана (textarea "Reason"). **Доступен только до `start_time`** — для In progress / Ended / Cancelled кнопка disabled (то же ограничение, что у капитана, см. "Reject / Kick / Leave flows" в [match.md](./pitchup-spec-match.md)). Если нужно убрать уже идущий или прошедший матч — только через `[Delete]` (hard delete) и только для нелегитимных случаев.
- **Hide text** — модерационный инструмент для оскорбительного / нелегитимного текста **в любом статусе** матча (включая In progress / Ended / Cancelled, где Edit/Cancel уже недоступны). Это **не редактирование** — админ не переписывает текст за капитана, а скрывает оригинал плейсхолдером. Подробности — в "Hide text (модерация текстовых полей)" ниже.
- **Delete** = hard delete. Матч и все связанные данные (записи, чат, лайки) стираются. Без in-app inbox / email **уведомлений участникам** — это инструмент для нелегитимных матчей (спам, поддельные). Cancel — стандартный путь когда матч просто не состоится. **Cross-ref:** при admin delete per-match SSE сервер шлёт служебный event `match_deleted` и закрывает соединение (см. "Per-match SSE" в [match.md](./pitchup-spec-match.md)). Frontend на открытой `/matches/:id` редиректит на `/games` с toast.
  - **SSE-событие при Delete.** Всем затронутым (бывший captain, accepted, pending, watching) backend пушит `my_match_changed: { match_id, my_status: 'cancelled', action: 'admin_deleted' }` в глобальный канал. Цель — не уведомить (это inbox/toast), а синхронно убрать карточку из открытых вкладок: `/my-matches → Section Upcoming` и `/chats` иначе залипнут на удалённый матч до ручного reload (на следующем fetch SSR увидит 404, но до того момента UI грязный). Событие НЕ создаёт notification в inbox, не пушит toast — только триггерит re-render списков. **Правило фронтенда при `action: 'admin_deleted'`:** карточку матча убрать из всех списков (`/my-matches` секции Captain/Upcoming, `/chats`) **без добавления в Section Past**. Удалённый матч не попадает в историю — он физически удалён из БД, `/matches/:id` → 404. Это отличие от `action: 'match_cancelled'`, где карточка перемещается в Section Past. Сам матч с открытой страницы `/matches/:id` показывает стандартный 404-экран "This match doesn't exist or was deleted." (см. "Error / empty pages" в [global.md](./pitchup-spec-global.md)).

#### Hide text (модерация текстовых полей)

**Проблема:** Edit запрещён после старта (см. `/matches/:id/edit` в [match.md](./pitchup-spec-match.md)), но в past-матче может остаться оскорбительная description или cancel-reason — спам, мат, угрозы. `[Delete]` сжигает всё (чат, лайки, историю) ради одного слова — слишком грубо.

**Решение — hide flag.** Админ не редактирует чужой контент, а скрывает с пометкой. Текст остаётся в БД (для апелляций / аудита), на UI отображается плейсхолдер. Reversible.

**Поля под модерацией:**
| Поле | Где видно когда не скрыто | Что показываем когда скрыто |
|---|---|---|
| `description` | Tab Details на `/matches/:id` | "[Description removed by moderator]" (нейтральный серый текст) |
| `cancel_reason` | Баннер cancelled на `/matches/:id`, MatchCard в /me History | "Match cancelled · [reason removed by moderator]" |

**Модель данных:** два булевых флага на матче — `description_hidden` (default false), `cancel_reason_hidden` (default false). Оригинальный текст не трогаем.

**UI в админке:** dropdown `[Hide text ▾]` на строке матча открывает чек-меню:
- ☐ Hide description — если у матча непустая description
- ☐ Hide cancel reason — только для cancelled-матчей

Тап на чекбокс — мгновенный toggle, никакой "Save" кнопки. Текущее состояние индикатором: если хоть один флаг включён — кнопка в строке подсвечена `[Hide text ⚑]`.

**Доступность:** во всех статусах (Open / Almost full / Full / In progress / Ended / Cancelled). Это намеренное исключение из правила "после старта менять нельзя" — модерация и редактирование контента это разные вещи.

**Уведомления:** никаких — это admin-action, никому не шлём (юзер сам увидит при заходе на матч). Audit-лог hide-операций в v1 не делаем; если нужно — заведём отдельной таблицей `admin_actions` позже.

### `/admin/venues` — Справочник стадионов
- Таблица: название / адрес / surface(s) / статус (active/inactive) / Google Maps ссылка
- Фильтр: status — все / active / inactive
- `[+ Add venue]` → форма:
  - Название
  - Адрес (текст)
  - Lat / Lng (числа — копируешь из Google Maps URL)
  - **Surface(s)** — multi-select из двух опций: `Grass` / `Hard surface`. Для экзотики (sand, rooftop) выбирается ближайший тип. Подробнее см. "Покрытие поля" в [global.md](./pitchup-spec-global.md).
  - **Cover** — single-select из палитры предзаготовленных иллюстраций (см. "Cover venue" в [global.md](./pitchup-spec-global.md)). Дефолт — детерминированно по `venue.id` (формула там же, не истинный random).
  - Google Maps URL (ссылка, вставляешь руками)
  - Active: toggle
- Редактирование — та же модалка `[+ Add venue]`, открывается с заполненными полями (клик `[Edit]` на строке). Деактивация — toggle "Active" внутри той же модалки. Никакого inline-edit в ячейках таблицы.
- **Защита от деактивации с upcoming-матчами:** если у venue есть хотя бы один матч с `start_time > now()` и статусом не Cancelled — toggle "Active" заблокирован (disabled) с подсказкой "Can't deactivate — N upcoming match(es) on this venue. Cancel them first or wait until they end." `[Save]` тоже блокируется если попытались переключить. Это спасает от случайной ошибки: иначе игроки увидят live-матч на стадионе которого нет в справочнике, и капитан не сможет его редактировать.
- **Деактивированный venue:**
  - Не показывается в поиске на `/matches/new` (нельзя создать новый матч на нём)
  - Прошедшие матчи на нём продолжают отображаться нормально (история не страдает)
  - В админ-таблице виден всегда (фильтр status)

### `/admin/reports`

**Откуда приходят жалобы:**
- **Report match** — `[⋯] → Report match` на `/matches/:id`. Только для залогиненных (гость пункт не видит).
- **Report player** — `[⋯] → Report player` на `/users/:id`. **Гость** видит кнопку, тап → Sign-in modal (см. "Визуальные отличия для гостя" в [global.md](./pitchup-spec-global.md)). Скрыто для своего профиля (`[⋯]` скрыт целиком) и для забаненных аккаунтов.

**Модалка отправки (user-facing, одинакова для обоих типов):**
- Заголовок: "Report this match" / "Report this player"
- Подпись: "We review all reports within 24 hours."
- Textarea "What's the issue?" — required, max 500 chars, placeholder "Describe the problem..."
- `[Submit report]` primary / `[Cancel]` ghost
- После отправки: toast "Report submitted. Thank you." Модалка закрывается. Никакого confirmation-экрана.
- Backend: `POST /api/reports` с `{ type: 'match'|'player', target_id, comment }`. Повторная жалоба от того же юзера на тот же объект — backend возвращает 200 без ошибки (тихо дедуплицируем, не спамим тостами).

**Список в `/admin/reports`:**
- **Группировка по объекту.** Жалобы агрегируются по `(type, target_id)` — одна строка на объект, даже если на матч/игрока пришло N жалоб от разных юзеров. В строке: тип (Match / Player) · объект (название матча или имя игрока — кликабельно, открывает `/matches/:id` или `/users/:id` в новой вкладке) · **счётчик `{N} reports`** (если N > 1, бейдж) · last reporter + дата последней жалобы · агрегированный статус (см. ниже) · кнопка `[Review]`. Без агрегации админ получил бы 100 одинаковых строк на популярного нарушителя.
- **Агрегированный статус строки (ladder):**
  - Если есть ≥1 жалоба со `status='New'` → группа `New`.
  - Иначе если есть ≥1 `Reviewed` → группа `Reviewed`.
  - Иначе → группа `Dismissed`.
- Действие `[Review]` берёт самую свежую `New`-жалобу (или самую свежую вообще, если все обработаны) — её комментарий + от кого показываются в modal'е, плюс ссылка "View all N reports" разворачивает список всех жалоб на этот объект внутри modal'а (комментарии + кто + когда + статус каждой).
- **Статусы жалобы** (per-row, не агрегированные): **New** / **Reviewed** / **Dismissed**. При `[Review]`-действии (Ban / Cancel match / Hide text / Delete) — **все** `New`-жалобы на этот объект автоматически переходят в `Reviewed`. При `[Dismiss]` — только текущая открытая жалоба → `Dismissed`, остальные на тот же объект остаются как были (админ может пройтись и разобрать каждую).
- Фильтр: тип (All / Match / Player), агрегированный статус (All / New / Reviewed / Dismissed)
- **Сортировка:** группа `New` всегда сверху, далее `Reviewed`, далее `Dismissed`. Внутри группы — по `latest_report_at DESC`.

**`[Review]` modal — жалоба на игрока (type: player):**
- Заголовок: "Report on player"
- Блок: аватар + имя + ссылка `[View profile ↗]`
- Полный текст комментария жалобы
- От кого + дата
- Кнопки:
  - `[Ban player]` destructive → закрывает этот modal, открывает **стандартный Ban modal** (textarea "Reason for ban" + `[Confirm ban]`) — тот же что в `/admin/users`. После бана → статус жалобы Reviewed.
  - `[Dismiss]` ghost → статус Dismissed. Toast "Report dismissed."

**`[Review]` modal — жалоба на матч (type: match):**
- Заголовок: "Report on match"
- Блок: venue name + дата + статус матча + ссылка `[View match ↗]`
- Полный текст комментария жалобы
- От кого + дата
- Кнопки (не взаимоисключающие — можно скрыть текст и отклонить жалобу):
  - `[Cancel match]` — видна только если матч Open / Almost full / Full (до старта). → открывает **стандартный Cancel modal** (textarea "Reason for cancellation") — тот же что у капитана. После отмены → статус жалобы Reviewed.
  - `[Hide description]` toggle — скрыть/показать description. Работает в любом статусе. Disabled если у матча пустая description. Тот же механизм `description_hidden` что и в `[Hide text ▾]` в `/admin/matches`. **Toggle hide/unhide статус жалобы НЕ меняет** — чтобы перевести в Reviewed/Dismissed нужен explicit `[Dismiss]` или destructive-action (Cancel/Delete match, Ban user).
  - `[Hide cancel reason]` toggle — скрыть/показать cancel_reason. Видна только для Cancelled-матчей (если матч не отменён — кнопка скрыта). Тот же механизм `cancel_reason_hidden` что и в `[Hide text ▾]` в `/admin/matches`. То же правило: toggle статус жалобы не меняет.
  - `[Delete match]` destructive — hard delete, любой статус. Тот же что `[Delete]` в `/admin/matches`.
  - `[Dismiss]` ghost → статус Dismissed. Toast "Report dismissed."
- `[Cancel match]` и `[Delete match]` автоматически переводят жалобу в Reviewed. `[Dismiss]` без других действий = "посмотрел, нарушений не нашёл".

**Связь с остальной админкой:** все action-модалки в `[Review]` — те же что в `/admin/users` и `/admin/matches`. Никакой дублированной логики, `[Review]` просто открывает нужную модалку с нужным `target_id`.

---

## Известные пробелы (осознанно не закрыты в v1)

Вопросы, которые всплыли при ревью спеки и оставлены на потом — это не баги, а сознательные решения "пока не нужно".

- **Venue deactivation — что с upcoming-матчами на этом venue.** Закрыто: toggle "Active" disabled пока есть хотя бы один не-cancelled матч с `start_time > now()` на этом venue. Подробности — в `/admin/venues` выше.
- **`/admin/users` нет действия `[Delete user]`.** Сознательно — удаление аккаунта только сам юзер из `/me` (Section ACCOUNT ACTIONS). Админ работает через `[Ban]` (перманентный, последствия описаны в "Бан / удаление аккаунта" в [global.md](./pitchup-spec-global.md)). Self-delete для админа защищён last-admin guard'ом (см. Section ACCOUNT ACTIONS в `/me` выше) — последнего админа удалить нельзя, надо сначала промоутнуть другого.
- **`/matches/new` edge: total=8, crew=7.** Матч публикуется сразу full (1 капитан + 7 stub'ов из `captain_crew`), доступна только кнопка `[Notify me]`. Не блокируем — пусть будет, пользователь сам разберётся. (Раньше edge был на `total=2`; после ограничения `total_spots ≥ 8` в `/matches/new` минимальный full-from-publish сдвинулся.)
- **Pending request message виден только в captain sheet, не в inline-кнопках Lineup.** Сознательно: inline = quick approve без чтения, sheet = полный review с сообщением.
- **Per-message модерация чата в ghost-match'е забаненного капитана.** Если капитан был забанен пока его матч идёт (InProgress без активного captain'а, см. "Ghost-match" в [global.md](./pitchup-spec-global.md)), per-message `[Delete]` в Tab Chat недоступен никому: captain — banned (backend отбивает), accepted-игроки не имеют этого права, у админа в v1 нет per-message delete в чате (только `[Hide text ▾]` для description/cancel_reason и `[Delete]` всего матча в `/admin/matches`). Оскорбительное сообщение в чате ghost-match'а можно убрать только hard-delete матча целиком. В v1 признано допустимым — кейс крайне редкий (captain должен быть забанен ровно между `start_time` и `start_time + duration` собственного матча). Если по фидбеку понадобится — заведём admin-level per-message delete отдельной фичей.
- **Визуальный индикатор "Gathering players" на пинах карты не делаем.** Статус виден в bottom-sheet превью при тапе на пин. На самих пинах — только цифра свободных слотов и красный=full.
- **Likes reminder → авто-открытие лайк-модалки не реализовано в v1.** Карточка "N match awaits your likes" на `/my-matches` ведёт на обычную `/matches/:id`, юзер видит CTA `[Like teammates]` и тапает сам. Авто-открытие по `?action=likes` — UX-улучшение, добавить если фидбек покажет что юзеры не находят кнопку.
- **Передача капитанства.** В v1 нет — капитан хочет выйти → отменяет матч. Компания переорганизуется сама через чат.
- **Отмена матча после `start_time`** (ливень после kickoff, массовая травма, форс-мажор) — в v1 не поддерживаем. После старта матч считается состоявшимся; решаем такие кейсы вне приложения (чат, личка). Иначе пришлось бы определять семантику для уже отправленного morning-reminder, для лайков, для статуса в History. Если по фидбеку выяснится что нужно — заведём "post-start cancellation" как отдельный flow.
- **Reminder morning-of-match — логика двух cron.** 10:00 для матчей с `start_time >= 10:00` сегодня (все оставшиеся матчи дня, включая утренние в 10:30, 11:00 и т.д.); 20:00 для матчей с `start_time` завтра 00:00–11:59. Email accepted + капитану матча. Подробности — в "Cron-задачи" в [match.md](./pitchup-spec-match.md). DST-семантика и идемпотентность через `reminder_sent` — в "Cron-задачи" в [match.md](./pitchup-spec-match.md).
- **Уведомление "Match details updated".** Уходит только accepted. Pending и watching не трогаем.
- **`/my-matches`: куда падают Cancelled-матчи.** Закрыто: cancelled-матчи сразу падают в Section Past после cancel. Подробности — в "Состояния матча → Cancelled" в [match.md](./pitchup-spec-match.md). Решение принято потому что Section Upcoming должен показывать только live-матчи (иначе "Your next match" укрупнённая карточка сверху может оказаться cancelled-баннером).
- **Language toggle в `/me` — не делаем в v1.** UI только EN, толкать toggle с одним вариантом бессмысленно. Появится сильно позже вместе с CS-переводом (next-intl уже заложен в коде). Когда добавим — пункт `Language: EN / CS` отдельной секцией в `/me`, default EN, выбор сохраняется в профиле.
- **Динамическая OG-картинка per-match.** В v1 — одна статика на все матчи (`/og/match-default.png`). Когда добавим — `@vercel/og` runtime-генератор: cover-gradient venue + venue name + дата/время + "N/M players" + мелкий лого. Это даст ~5× CTR в чатах (rich preview с реальными данными конкретного матча vs. одинаковая картинка). Реализация в Next.js 15: `app/matches/[id]/opengraph-image.tsx`.
- **Post-publish "Share with your crew" модалка** на шаге 3 `/matches/new`. Сейчас просто toast + redirect. Момент пиковой мотивации капитана раздавать ссылки упущен — сознательно не делаем в v1 ради minimal scope. Капитан шарит через `[⋯] → Share` как все.
- **Share-кнопка в captain sheet** — отдельной prominent кнопки нет, шеринг через общий `[⋯] → Share`. Если по фидбеку капитаны не находят — вынесем.
- **Share-аналитика** (счётчик shares на матч, source tracking utm-параметрами) — не делаем в v1. Корреляцию share → join можно прикинуть по органике.
- **`/games` и `/map` chips-only фильтры — выпавшие опции.** Сознательно убрали в v1 ради простоты: custom date range (Period — есть только Tonight/Weekend, остальное скроллом списка), Price=Paid (никто не фильтрует "только платные"), Spots left = 2-3 (есть только `⚡ 1 spot left`), Near me с дистанциями 3/10 km (фиксировано 5km), чип `👤 My matches` (заменён отдельным табом `/my-matches`). Если по фидбеку понадобится — добавим назад как чипы или возвращаем кнопку `[Filters ▾]` для advanced.
- **Time display boundary на ровно 24h.** При переходе с countdown ("Starts in 23h 59min") на абсолютную дату ("Tue 20 May, 19:00") в момент 24:00 будет резкий скачок формата. Polling раз в 10s — заметить можно. Не правим: фронт перечитывает один и тот же `start_time`, формула `delta < 24h ? countdown : abs` — это 1 строка кода, и скачок раз в жизни матча. Граница: `delta < 24h` → countdown, иначе дата (т.е. ровно 24:00:00 = абсолютная дата).
- **`/chats` — расширения v1.1+.** Сознательно скоупим v1 до минимума:
  - **DM 1-1** между игроками — нет. Общение только в контексте конкретного матча. Если игроки хотят созвониться "вне" — у каждого в профиле есть Contact info (telegram/whatsapp/email).
  - **Preview последнего сообщения** на карточке в `/chats` — нет. Только unread dot + match-info. Telegram-стиль ("last message: 'кто принесёт мячи?'") добавим в v1.1.
  - **Mention-нотификации** (@username при апоминании в чате) — нет в v1. У нас нет usernames, и chat-volume пока низкий.
  - **Inbox folders / категории** (Active / Archived / Unread) — нет. Один плоский список, отсортированный по последней активности.
  - **Поиск по чатам** — нет. Список ограничен своими матчами, скролл найдёт нужный.
- **Admin role bootstrap edge case.** Если все админы забанены (баг данных, ручной mass-ban через SQL и т.п.) — система не сможет восстановить их через UI (требует залогиненного админа). Восстановление — ручной SQL: `UPDATE users SET banned=false WHERE id=...` + `DELETE FROM revoked_sessions WHERE user_id=...`. См. также "Bootstrap первого админа" в [global.md](./pitchup-spec-global.md).
- **Username / handle — нет в v1.** Идентификация в UI = name + avatar. Поле `handle` в БД отсутствует. Рассмотреть в v1.1 если понадобится deeplink на профиль / уникальный шер-URL (`/u/markh` вместо `/users/:uuid`).
- **Appeals** (апелляция на бан) — обрабатываются вручную через Google Workspace alias `appeals@`. Админка для апелляций (страница `/admin/appeals` с очередью) — не в v1.
- **`[Show older]` пагинация в Updates bottom-sheet** — не в v1. Лимит 20 записей, mark-as-read применяется ко всем непрочитанным (включая те что за пределами 20-го, если они существуют — крайне редкий кейс, TTL 30 дней).
- **Передача капитанства** (transfer captaincy на другого accepted-игрока) — не в v1. Дублируется в "Что НЕ делаем в v1" ниже.
- **Recurring matches** (повторяющиеся еженедельные слоты) — не в v1.

---

## Что НЕ делаем в v1

- Платежи в апке
- Загрузка пользовательских фото (аватар — только из Google, нет файл-хранилища)
- **Дополнительные OAuth-провайдеры.** В v1 только Google. Apple/Facebook/email-password — позже, когда будет реальный сигнал спроса (юзеры из стран где Google-аккаунт не дефолт, корпоративные email без Google-привязки). JWT и middleware уже готовы расшириться до `(provider, providerId)` композитного ключа — см. "Что лежит в JWT" в [global.md](./pitchup-spec-global.md).
- Нативные приложения (PWA)
- WebSocket чат (используем SSE — проще и достаточно для one-way пушей)
- Видео, AI-хайлайты
- Турниры / лиги
- Букинг полей
- Соцсеть-функционал (followers, лента)
- SMS-уведомления
- **Team shuffle: персистентность и фичи.** Сама фича `[Shuffle teams]` в v1 есть (см. "Shuffle teams" в [match.md](./pitchup-spec-match.md)), но в максимально простом виде:
  - Результат хранится только в **localStorage** капитана — другое устройство / incognito / очистка кэша = шафлить заново.
  - Игроки результат **не видят** в приложении (нет SSE-пуша, нет блока в Tab Lineup, нет системного сообщения в чат). Капитан сам копирует `[Copy as text]` и шлёт куда нужно.
  - Балансировки нет — pure random, без skill / weight / win rate.
  - Ручной правки после shuffle нет (только `[Shuffle again]`).
  - Гости (`+N`) идут в шафл как обезличенные `Guest 1, Guest 2, ...` — сознательный пинок чтобы регистрировались. См. "Shuffle teams" в [match.md](./pitchup-spec-match.md).
