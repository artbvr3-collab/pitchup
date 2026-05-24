# PITCHUP — Translation Glossary & Cheat Sheets (RU → EN)

> Рабочий документ для перевода спеки на английский. Не часть финальной спеки.
> Цель — зафиксировать **одно правильное соответствие** для каждого ключевого термина, чтобы не было дрейфа между файлами.
>
> Если встретил термин не из этого глоссария — **сначала добавь сюда**, потом переводи.

---

## 1. Доменные термины (entities & roles)

| RU | EN (canonical) | Примечание |
|---|---|---|
| матч | match | — |
| стадион / venue | venue | "venue" уже используется в спеке. Не "stadium" |
| поле (футбольное) | field | в контексте surface/booking. "pitch" не используем |
| покрытие | surface | `Grass` / `Hard surface` — UI labels; `grass`/`hard` — backend tokens |
| шипы | studs | `studs_allowed`, "Studs OK" / "No studs" |
| район | district | в адресе venue (Prague districts) |
| цена | price | валюта только Kč |
| ростер | roster | в Lineup / Tab Lineup |
| ковёр (venue cover) | cover | `cover_id`, "cover venue" |
| капитан | **captain** (роль) / **organizer** (в публичных UI-строках) | Спека различает: "captain" = роль; "Organizer:" = label в Lineup и "Organizer account was removed". **Не перемешивать** |
| игрок | player | — |
| гость (не залогинен) | guest | "guest access", "for guest" |
| гость (+N) | guest | `guest_count`, "+N" badge |
| crew | **crew** | terminology locked: массив stub player'ов в `captain_crew` |
| stub player | **stub player** | terminology locked: одна запись-имя в `captain_crew` |
| админ | admin | `is_admin`, `/admin/*` |
| модератор | — | в v1 нет отдельной роли, только `is_admin` |
| заявка | (join) request | DB: `JoinRequest`. UI: "request", "Your request" |
| approve | approve | endpoint `/approve`, status `accepted` |
| отклонить (заявку) | **reject** (DB) / **decline** (UI) | спека жёстко фиксирует: DB-схема "rejected", UI label "Declined". См. секцию `rejected vs declined` в `global.md` |
| кикнуть | kick | endpoint `/kick`, status `kicked` |
| Leave (уйти из матча) | leave | endpoint `/leave`, status `left` |
| watch / "Notify me" | watch / watching | флаг на full-матчах |
| лайк | like | `/api/matches/:id/likes` |
| жалоба | report | `/api/reports`, `/admin/reports` |
| бан | ban / banned | `users.banned` |
| удаление аккаунта | account deletion / delete account | `DELETE /api/me` |
| продвинуть в админы | promote (to admin) | `[Promote to admin]` |
| разжаловать | demote (to user) | `[Demote to user]` |
| captain sheet | captain sheet | bottom-sheet с captain-tools, открывается через `[Manage match]`. **Не** "captain panel" / "captain workspace" |
| ghost match | ghost match | InProgress-матч, потерявший капитана (бан/удаление). См. `global.md` → "Ghost-match" |
| watching-юзер / watching-игрок | watching player | юзер с активной watch-подпиской. **Не** "watcher" |
| pending-игрок | pending player | юзер с `JoinRequest.status='pending'` |
| accepted-игрок | accepted player | юзер с `JoinRequest.status='accepted'` |
| авто-реджект | auto-reject | verb & noun. Cron auto-reject pending при start_time / при cancel |
| re-apply (повторная заявка) | re-apply | повторный Join после leave/kick — UPSERT UPDATE в `pending` |

---

## 2. UI и навигация

| RU | EN |
|---|---|
| карточка (матча) | (match) card. Компонент — `MatchCard` (не переводим имя) |
| вкладка (браузера) | (browser) tab |
| таб (страницы) | tab. Tab Chat / Tab Lineup / Tab Details — не переводим, это namespaces |
| Секция (на странице `/my-matches`) | Section. Section Captain / Upcoming / Past — не переводим |
| панель Updates | Updates panel (bottom-sheet) |
| лента / список | list / feed (по контексту; "feed" редко) |
| тап | tap |
| тап-на-X | tap on X |
| редирект / редиректить | redirect (verb & noun) |
| модалка | modal |
| тост | toast |
| баннер | banner |
| чип (PlayerChip) | chip. Компонент `PlayerChip` — не переводим |
| лого | logo |
| шапка / TopBar | TopBar (не переводим) |
| нижняя нав / BottomNav | BottomNav (не переводим) |
| ghost-кнопка | ghost button |
| primary-кнопка | primary button |
| дисейблед | disabled |
| stepper (UI) | stepper |
| bottom-sheet | bottom-sheet |
| превью | preview |
| hero (картинка) | hero |
| skeleton (loader) | skeleton |
| бейдж | badge |
| sub-label (под названием на карточке) | sub-label |
| счётчик слотов | slot counter |
| countdown | countdown |
| chip input | chip input (для crew, фильтров) |
| popover (меню) | popover |
| пин (на карте) | pin / map pin |
| pulse (анимация пина) | pin pulse |
| sticky filter bar | (sticky) filter bar |
| day picker | day picker |
| info chip / strip | info chip · info chip strip |
| Location modal | Location modal (UI name, capitalized) |
| pick-location mode | pick-location mode |
| location status chip | location status chip |
| venue sheet | venue sheet (bottom-sheet с матчами на venue) |
| multi-pin sheet | multi-pin sheet |
| укрупнённая карточка "Your next match" | featured card |
| unread dot | unread dot |
| captain-only кнопка | captain-only (adjective) |
| draft state (локальные изменения фильтров) | draft state |
| read-only чат | read-only chat |
| message bubble | message bubble |
| лента сообщений | message feed |

---

## 3. Технические / архитектурные термины

Эти **не переводим** — оставляем в исходном английском, даже если в RU-спеке они написаны кириллицей:

middleware, JWT, claim, callback, cookie, OAuth, fetch, endpoint, transaction, advisory-lock, snapshot, race, idempotent, UPSERT, INSERT, SELECT, RETURNING, denormalization, JOIN, index, primary key, foreign key, enum, cron, TTL, SSE, polling, heartbeat, payload, push (notification), service worker, PWA, viewport, breakpoint, namespace, fallback, rollback, deep-link, hard cap, hard delete, soft delete, edge case, flow, race condition, opt-in / opt-out, sign-in / sign-out, multi-tab, cross-site, same-origin, http-only, SameSite=Lax.

**Кириллические дубли — заменять на EN:**
- "юзер" → user
- "юзкейс" → use case
- "флоу" → flow
- "роллбэк" → rollback
- "снапшот" → snapshot
- "ребилд" → rebuild
- "промоут" → promote
- "сабмит" → submit
- "ретрай" → retry
- "пуш" → push (notification)
- "коммит" (БД) → commit

---

## 4. Заголовки разделов (главные)

| RU | EN |
|---|---|
| Глобальные решения | Global decisions |
| Аутентификация | Authentication |
| Данные пользователя | User data |
| Уникальный логин / username | Unique login / username |
| Повторный вход | Returning sign-in |
| Guard онбординга (middleware) | Onboarding guard (middleware) |
| Доступ гостя (не залогинен) | Guest access (not signed in) |
| Viewport — только mobile-design | Viewport — mobile design only |
| Язык UI и i18n | UI language & i18n |
| Форматы матчей | Match formats |
| Покрытие поля | Field surface |
| Статус брони поля | Field booking status |
| Тип матча | Match type |
| Total spots — hard cap для approve | Total spots — hard cap on approve |
| Гости (+N при подаче заявки) | Guests (+N on join) |
| Slot math | Slot math (как есть) |
| Уведомления | Notifications |
| Polling sync (глобальный опрос) | Polling sync |
| Бан / удаление аккаунта | Ban / account deletion |
| Bootstrap первого админа | First-admin bootstrap |
| Валидация и санитизация текстовых полей | Text field validation & sanitization |
| Cover venue | Cover venue (как есть) |
| Карта сайта | Site map |
| Entry-страницы | Entry pages |
| Глобальные компоненты | Global components |
| Error / empty pages | Error / empty pages (как есть) |
| Legal pages | Legal pages (как есть) |
| Известные пробелы | Known gaps |
| Что НЕ делаем в v1 | Out of scope for v1 (либо "What we DON'T do in v1" — выбрать одно и держаться) |
| Конкурентность и блокировки | Concurrency & locking |
| Cron-задачи | Cron jobs |
| Состояния матча | Match states |
| Approve flow | Approve flow (как есть) |
| Reject / Kick / Leave flows | Reject / Kick / Leave flows (как есть) |
| Watching логика | Watching logic |
| Admin role management & safety | как есть |
| Captain sheet (раздел в match.md) | Captain sheet |
| Видимость `[Manage match]` по статусам | `[Manage match]` visibility by match status |
| Права капитана в чате | Captain's chat permissions |
| Лайки после матча | Post-match likes |
| Перенос матча | Match rescheduling |
| Состояния игрока на матче | Player match states |
| Стратегия — advisory lock per match_id | Advisory lock strategy (per match_id) |
| Идемпотентность | Idempotency |
| Write ordering (уведомления внутри транзакции, poll-состояние после commit) | Write ordering: notifications inside transaction, poll state after commit |
| Race-пары — что разруливается чем | Race scenarios — resolution matrix |
| Шаг 1 / 2 / 3 (wizard) | Step 1 / 2 / 3 |
| Геолокация и хранение локации | Geolocation & location storage |
| Поведение Apply / Reset | Apply / Reset behavior |
| Bottom-sheet "More filters" | "More filters" sheet |
| Hide text (модерация текстовых полей) | Hide text (content moderation) |
| Likes reminder (секция) | Likes reminder section |

---

## 5. Часто встречающиеся обороты (idiom cheat sheet)

| RU | EN |
|---|---|
| Не путать с X | Not to be confused with X / Don't confuse with X |
| Сознательно / намеренно | Intentionally / by design |
| Это закрывает кейс X | This covers the X case |
| По умолчанию | By default |
| См. X в [файл] | See X in [file] |
| Подробнее — X | More on this in X |
| В двух словах | In short |
| Тут понятно | Self-explanatory |
| Курица и яйцо | Chicken-and-egg |
| Без магии / без скрытой логики | No hidden magic |
| Сознательное упрощение | Intentional simplification |
| Источник правды | Source of truth |
| На уровне X | At the X level |
| Это компромисс | This is a trade-off |
| Жёсткий потолок | Hard cap |
| На read-time / write-time | On read / on write |
| В той же транзакции | In the same transaction |
| После commit'а | After commit |
| По индексу | Via the X index |
| Внутри транзакции | Inside the transaction |
| Что НЕ через этот канал | What does NOT go through this channel |
| Тихо / silent | Silent (no notification) |
| Material / non-material changes | как есть (термин зафиксирован) |
| Залогиненный юзер | Signed-in user |
| Незалогиненный / гость | Guest / not signed in |
| Залить (фоном) | Fill (with background) |
| Поправить | Edit / adjust |
| Закрыли вкладку | Closed the tab |
| Дропнул онбординг | Dropped off during onboarding |
| Засветить (например, существование админки) | Reveal / expose |
| Силами админа | By the admin |
| Из коробки | Out of the box |
| Status-first (принцип каскада CTA) | Status-first (principle) — статус матча проверяется раньше роли |
| Разовый зов (watching) | one-shot (notification / dispatch) — not a persistent subscription |
| Backstop (серверная защита) | backstop |
| Стейловый / устаревший | stale |
| Дедуплицировать | deduplicate (verb) |
| Дёргать / не дёргаем (= уведомлять) | notify (verb) |
| Эфемерный | ephemeral |
| Перетекать на следующий день | spill into the next day |
| Зависнуть на форме | stall on the form / leave the form open |

---

## 6. Что **НЕ** трогать при переводе

1. **Backend tokens & DB-values** в кавычках/backticks: `'pending'`, `'accepted'`, `'rejected'`, `'left'`, `'kicked'`, `grass`, `hard`, `live`, `match_started`, `match_cancelled`, и т.п.
2. **Field names**: `field_booked`, `captain_crew`, `total_spots`, `guest_count`, `start_time`, `cancelled_at`, `revoked_sessions`, `google_sub`, `email_notifications`, `is_admin`, `banned`, `cover_id`, `studs_allowed`, `auto_reason`, `read_at`, `jti` и т.п.
3. **Component names**: `MatchCard`, `PlayerChip`, `TopBar`, `BottomNav`, `Tab Chat`, `Tab Lineup`, `Tab Details`, `Section Captain`, `Section Upcoming`, `Section Past`.
4. **URL paths**: `/games`, `/map`, `/matches/:id`, `/my-matches`, `/chats`, `/me`, `/users/:id`, `/welcome`, `/login`, `/admin/*`, `/api/*`.
5. **File names**: `pitchup-spec-*.md`, `pitchup-app-map.md`, `*.png`, `/og/landing.png`.
6. **HTTP/Web constants**: `401`, `403`, `409`, `429`, `Origin`, `Sec-Fetch-Site`, `SameSite=Lax`, `Retry-After`, `Notification.permission`, `document.hidden`, `localStorage`, `Etc.`
7. **Финальные UI-строки в кавычках** — они уже EN, не трогаем:
   - `"Sign in to join this match"`, `"You're in ✓"`, `"Waiting…"`, `"Match cancelled"`, `"Not enough spots — increase Total or reject"`, `"Bringing friends"`, `"Field booked"`, `"Gathering players"`, `"Almost full"`, `"Full"`, `"You were removed"`, `"[Removed user]"`, `"This user is no longer on PITCHUP."`, `"Account banned"`, `"Sign-in cancelled. Try again when you're ready."`, `"Sign-in failed. Try again."`, `"Welcome to PITCHUP"`, `"Get started →"`, `"No updates yet"`, и т.д.
   - **Если видишь строку в кавычках и она уже на английском — это финал**, не перепиши её случайно.
8. **Тестовые данные / примеры**: имена `Mark H.`, `Pavel`, `Tomas`, `Ivan Novak`; географические `Prague`, `Kč`, `Europe/Prague`.
9. **Code blocks** (```...```): SQL/JS код, формулы, ERD-фрагменты — не трогаем.

---

## 7. Tone & style

- Спека написана **в живом инженерном тоне** — не казённом, не маркетинговом. EN — то же самое.
- Короткие предложения. Точка вместо длинного "которое позволяет".
- Активный залог. "Backend rejects the request" > "The request is rejected by backend".
- Технические объяснения в формате "что → почему": "We don't sync Google profile. Reason: user can edit name in `/me`."
- "Мы" в RU → переводим в зависимости от контекста: `we` (мы как команда продукта: "we don't do X in v1") или безличное (`The system X` / `X is …`). В большинстве случаев **`we`** — спека человек-человеку, не "система".
- "Юзер" / "игрок" / "капитан" — третье лицо, "the user / the player / the captain" (или "they"). Не "you" в основном тексте (это не туториал).

---

## 8. Markdown structure — сохранять 1:1

- Все таблицы, bullet-listы, headings (`#`, `##`, `###`), длинные тире `—`, backticks `\`…\``, bold `**…**`, italic `*…*`, blockquotes `>` — оставлять структурно идентично.
- Cross-file ссылки `[match.md](./pitchup-spec-match.md)` — имена файлов не меняются, ничего не ломается.
- `⚠`, `→`, `·`, `→` — emoji/символы сохранять.
- Числа, формулы, code-блоки — не трогать.

---

## 9. Спорные / опасные места — отдельно обдумать

1. **"Бронь поля"** vs **"field booking"** — `field_booked` уже EN-токен; "booking" последовательно использовать вместо "reservation". **Не** переводить как "field reservation".
2. **"Заявка"** — в JSON / API context это **"join request"** или просто **"request"**. В DB / general контексте — **"request"**. Не "application", не "claim".
3. **"Принять / Approve"** — в спеке `approve` (endpoint), но статус — `accepted`. EN сохраняет это различие: глагол **approve**, состояние **accepted**.
4. **"Отклонить"** — DB: **reject**, UI label: **Decline**. Спека жёстко это фиксирует в `global.md` ("rejected (БД) vs declined (UI/SSE) — единый словарь"). При переводе текста спеки — соответственно: когда речь о БД/API ("backend rejects"), когда об UI ("user sees 'Declined'").
5. **"Снять заявку"** (отменить pending) — **cancel request** (endpoint: `/cancel-request`, action: `request_cancelled`).
6. **"Слот"** — **slot**. Множественное — **slots**. Не "place", не "seat".
7. **"Стадион"** vs **"venue"** — в спеке "venue" уже устоялось. Используем **venue** везде, даже когда в RU написано "стадион".
8. **"Капитан"** при создании матча — **captain** (роль). "Organizer:" в UI labels — **organizer**. Это **не синонимы**, спека их различает.
9. **"Гость"** — context: (a) **guest** = не залогинен; (b) **guest** = `+N` на заявке. Оба слова одинаковые, контекст разруливает. Если совсем мешает — для (b) допустимо `+N friend`.
10. **"Crew"** vs **"crew member"** — спека фиксирует: **crew** = массив stub'ов целиком; **stub player** = одна запись. **"crew member"** в спеке запрещено.
11. **`[Manage match]`** vs **captain sheet** — `[Manage match]` = CTA-кнопка; **captain sheet** = bottom-sheet, который она открывает. Не путать. Не использовать "captain workspace" / "captain panel".
12. **spot** vs **slot** — **slot** = единица вместимости (Slot math, `total_spots`, технические расчёты, "free slots"). **spot** = в UI-строках про места ("5 spots open", "1 spot left", "A spot just opened"). В прозе спеки — slot; в финальных UI-строках — spot. Не смешивать.
13. **Notify me** / **Watch** / **watching** — одна фича, четыре имени: `[Notify me]` (UI button), `Watch` (DB table & verb in code: `POST /watch`), `watching` (status enum, `my_status`), watch-подписка (русское). EN: **Watch** — технический контекст; **Notify me** — UI labels; **watching** — status. **"watcher" не используем.**
14. **Ended** vs **Past** — **Ended** = статус матча (`match.status`, on-read из `end_time < now()`). **Section Past** = секция на `/my-matches` (показывает `match.status ∈ {Ended, Cancelled}`). В прозе допустимо **past match**; если речь о статусе — **ended match**.
15. **report** — глагол и существительное. EN: **report** (verb: "to report a player"; noun: "a report was submitted"); **submit a report** (формальное действие). DB-таблица `Report`, UI `[Report player]` / `[Report match]`.
16. **In-app inbox** vs **Updates panel** — одна фича: **in-app inbox** = generic концепт ("уведомление упало в inbox"), **Updates panel** = конкретный UI-компонент (bottom-sheet по тапу на 🔔). В техническом тексте — in-app inbox; когда речь об UI — Updates panel.
17. **Hide text** vs **content moderation** — **`[Hide text]`** = UI label кнопки. **content moderation** / **hide flag** = действие/паттерн в прозе. Два булевых флага: `description_hidden`, `cancel_reason_hidden`.

---

## 10. Per-area specifics

Доменные термины, специфичные для отдельных страниц/областей спеки. Группировка по подразделам помогает держать вокабуляр когерентным внутри одного файла спеки.

### A. Chat (Tab Chat в match.md)

| Термин | EN | Примечание |
|---|---|---|
| лента сообщений | message feed | в UI-контексте |
| сообщение (bubble) | message bubble | одна реплика |
| chat frozen | chat frozen | состояние после cancel/admin-delete; backend → `409 chat_frozen` |
| read-only чат | read-only chat | для watching/guest — без composer |
| статичный snapshot чата | static snapshot | чат рендерится без SSE на момент загрузки |
| mark as read | mark as read | действие при открытии Tab Chat |
| per-message delete | per-message delete | feature: captain/admin может удалить отдельное сообщение |
| composer (поле ввода) | composer | input area внизу чата |

### B. Cron / фоновые процессы (match.md → "Cron-задачи")

| Термин | EN | Примечание |
|---|---|---|
| morning-of-match reminder | morning-of-match reminder | полное имя; сокращённо — **morning reminder** |
| утренний / вечерний cron | 10:00 reminder / 20:00 reminder | оба в `Europe/Prague`, не UTC |
| Inbox TTL cleanup | Inbox TTL cleanup | ежедневно 03:00 Prague, чистит `notification` старше 30 дней + `revoked_sessions` старше 334 дней |
| Cron auto-reject | cron auto-reject | при `start_time` прошёл — массовый reject pending'ов |
| DST | DST (Daylight Saving Time) | поведение cron при переходах |
| spring-forward / fall-back | spring-forward / fall-back | как есть |
| batch (пачкой) | batch (verb & noun) | "авто-реджектит пачкой" → "auto-rejects in batch" |
| duplicate guard | duplicate guard / idempotency guard | защита cron от повторов при ретраях/рестартах |

### C. Geolocation & map (discovery.md)

| Термин | EN | Примечание |
|---|---|---|
| GPS-запрос | GPS permission request | разовый запрос пермишена |
| ручной пин | manual pin | `source: 'manual'` в location-хранении |
| отказ в геолокации | location denial (generic) / GPS denial (specific) | по контексту |
| persistent denial | persistent denial | юзер отказал и браузер запомнил |
| viewport center / центр карты | viewport center | для сохранения локации |
| `map.flyTo` | fly to | плавное центрирование |
| pin pulse | pin pulse | анимация ≈600ms при центрировании |
| Haversine distance | Haversine distance | расчёт расстояния в SQL |
| 21-day horizon | 21-day horizon | временное окно фильтрации (`/games` day picker, `?date=` валидация, `/map` pins, venue sheet, Next chip, `/matches/new` upper bound). Определено в global.md → "Timezones & date ranges" как `prague_range(today_prague(), today_prague() + 20)` |
| Prague day / пражский день | `prague_day(d)` | каноническая функция: для даты `d` в Europe/Prague возвращает полуоткрытый UTC-интервал `[utc_start, utc_end)`. Длина 23/24/25h в зависимости от DST. Единственный способ конвертить день — нельзя писать `BETWEEN start_of_day_utc AND end_of_day_utc` вручную |
| today_prague() | `today_prague()` | текущая календарная дата в Europe/Prague (YYYY-MM-DD, не timestamp) |
| prague_range(d1, d2) | `prague_range(d1, d2)` | inclusive Prague-day range: `[prague_day(d1).utc_start, prague_day(d2).utc_end)` |

### D. Edit flow refinements (match.md → /matches/:id/edit)

| Термин | EN | Примечание |
|---|---|---|
| material changes (поля) | material changes | `start_time`, `duration`, `venue_id`, `surface`, `studs_allowed`, `price`, `field_booked` — список **фиксированный** |
| non-material changes (поля) | non-material changes | `total_spots`, `captain_crew`, `description` — silent, без notification |
| silent update | silent update | non-material edit — `matches_changed` entry в следующем poll без `notification` row |
| `409 concurrent_modification` | concurrent_modification | race с другим Edit на том же матче |
| `409 capacity_below_filled` | capacity_below_filled | попытка снизить `total_spots` ниже current accepted |

### E. Admin specifics (personal.md → /admin/*)

| Термин | EN | Примечание |
|---|---|---|
| audit-лог | audit log | таблица `admin_actions`, фиксирует все admin-действия |
| status ladder | status ladder | приоритет агрегированного статуса (New > Reviewed > Dismissed) |
| группировка по объекту | grouped by target | агрегация отчётов по match/player |
| агрегированный статус | aggregated status | финальный статус строки в `/admin/reports` |
| защита последнего админа | last-admin guard | защита от удаления единственного активного админа |
| последний незабаненный админ | last remaining admin | предикат `is_admin=true AND banned=false` count |
| hide flag | hide flag | `description_hidden` / `cancel_reason_hidden` |
| reversible (действие) | reversible | можно откатить (Hide text → Unhide) |
| деактивация venue | venue deactivation | в `/admin/venues` |
| toggle button pair | toggle button pair | паттерн "видна одна из двух" (Promote ↔ Demote, Ban ↔ Unban) |

---

## 11. Workflow перевода

Для каждого файла (`global.md`, `discovery.md`, `match.md`, `personal.md`, `app-map.md`, `INDEX.md`):

1. **Прогон 1 — перевод по глоссарию.** Пройти линейно, сверяясь с разделами 1-6 этого файла.
2. **Прогон 2 — terminology check.** `grep` по результату: 
   - `rejected` появляется только в DB/API контексте; `declined` — только в UI.
   - `captain` vs `organizer` — проверить вручную пару точек.
   - Нет случайных переводов финальных UI-строк (раздел 6.7).
3. **Прогон 3 — cross-file refs.** Убедиться что ссылки `[X](./Y.md)` не сломаны; имена secций в anchor-фрагментах (если будут) совпадают.
4. **Если встретил новый термин которого нет в глоссарии** — **добавить сюда** до того как переводить, иначе появится дрейф между файлами.
