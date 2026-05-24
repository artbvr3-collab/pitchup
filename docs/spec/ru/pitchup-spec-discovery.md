# PITCHUP — Спека: поиск матчей

> Часть спеки. Карта всех файлов — [INDEX](./pitchup-spec-INDEX.md).
> ⚠ **После правки этого файла** — пройди audit-checklist в шапке [pitchup-app-map.md](./pitchup-app-map.md) и синхронно обнови карту, если затронуты пункты чек-листа (стек, нав, TopBar, login, PWA, cron, lifecycle, сущности).
> Здесь: `/games` (список) и `/map` (карта). Оба guest-readable, share filters через URL.

---

## `/games` — Список матчей

Бывший `/discover` в list-режиме. Главный публичный пул, доступен гостям.

**Layout (сверху вниз):**
1. TopBar (лого + 🔔; для гостя — лого + `[Sign in]`). См. компоненты в [global.md](./pitchup-spec-global.md).
2. **Sticky filter bar** (h≈56px):
   - Поле поиска `[🔍 Search venue...]` — live-filter по названию стадиона.
   - **`[⚙]` icon-button** справа от searchbar — открывает bottom-sheet "More filters" (см. отдельный раздел ниже). Когда активен ≥1 sheet-фильтр — на иконке маленький accent-dot (badge) в правом верхнем углу. Доступна и гостю (фильтры публичные, ничем не auth-gated).
   - Справа от `[⚙]` — кнопка **`[+ New match]`** (обычная кнопка, не FAB). Для гостя — тап на неё → `/login?callbackUrl=/matches/new`.
3. **Sticky day picker** (h≈64px, sticky вместе с filter bar — это основной фильтр, должен быть всегда виден). Горизонтальная лента дней:
   - Каждая ячейка — 2 строки: имя дня сверху (`Tue`, `Wed`, ...), число снизу (`19`, `20`, ...). Локализация дня — английский в v1 (UI только EN).
   - **Активный день** — обведён thin border (rounded box), как в референсе. Неактивные — без обводки, только текст.
   - **Single-select.** Один день всегда выбран — нет "all" / "any" режима. Тап на уже активный день — ничего не делает (нельзя снять).
   - Лента — **21 день начиная с сегодня** (типичный горизонт пикап-футбола; матчи дальше 3 недель — редкость, см. "Известные пробелы" в [personal.md](./pitchup-spec-personal.md)). Видно ~7 дней одновременно, остальное горизонтальным scroll'ом.
   - **Default:** сегодня. Если выбранный день не сегодня — под лентой маленькая ghost-кнопка `[← Today]` (слева, не в самой ленте), тап возвращает в сегодня.
   - **Подпись под лентой** — мелким серым: `Today` / `Tomorrow` / полное имя дня + число (`Thursday 21`) / `DD MMM` для дат больше недели. Дублирует выбор для читаемости.
   - **Прошлые даты в picker'е не показываем** — лента начинается с сегодня. Завершённые матчи живут в `/my-matches → Section Past`, не в публичном поиске (см. "Cancelled-матчи" ниже про тот же принцип).
4. **Список MatchCard'ов** за выбранный день, отсортированный по `start_time` ASC. **Группировки по дате нет** — все карточки за один день, секционный заголовок не нужен. Над списком — мелкая подпись `{N} matches` (`12 matches today`).
5. **BottomNav.**

### Bottom-sheet "More filters"

Открывается тапом по `[⚙]` в filter bar (layout п.2). Header "Game filters", крестик `[✕]` слева. Контент — секции с подзаголовками. Footer (sticky внутри sheet'а): `[Apply filters]` primary + `[Reset]` ghost (центр).

**Поведение Apply / Reset:**
- **Live-фильтрации внутри sheet'а нет** — изменения накапливаются локально (draft state), применяются только по `[Apply filters]`. Это сознательно: радио + multi-chip комбинации иначе спамят backend на каждый тап.
- `[Apply filters]` — закрывает sheet, переписывает URL-параметры (`?distance=`, `?time=`, `?size=`, `?spots=`), список пересчитывается. Если ни один sheet-фильтр не изменился относительно текущего применённого состояния — кнопка disabled, tooltip `"Nothing to apply"`.
- `[Reset]` (внутри sheet'а) — сбрасывает все sheet-фильтры в draft state в default (Any / пусто), но не закрывает sheet и не применяет автоматически. Чтобы зафиксировать сброс — `[Apply filters]`.
- **Закрытие sheet'а без Apply** (тап вне, swipe down, `[✕]`) — draft отбрасывается, применённые фильтры остаются как были.
- **При повторном открытии** sheet'а — поля показывают текущее применённое состояние (не последний draft).

**Секции sheet'а** (сверху вниз):

**📍 Distance** (radio). Показывается **всегда** (независимо от permission геолокации).
- **Локация установлена** (GPS или ручной пин в localStorage) → радио-кнопки: `Any` (default) / `1 km` / `3 km` / `5 km` / `10 km`
- **Локация не установлена** (любой permission state) → вместо радио одна кнопка `[Set location]`. Тап → переход на `/map?pickLocation=true` (карта откроет Location modal автоматически). **Автовозврата нет** — юзер сам возвращается на `/games` через BottomNav, когда локация установлена (sheet откроется с применёнными фильтрами, draft теряется по общему правилу — см. "Поведение Apply / Reset" выше). Это сознательное упрощение: один экран = одна задача, без скрытого state-passing'а.
- URL: `?distance=1|3|5|10` (отсутствие = Any). Если локация не установлена — параметр игнорируется (фильтр не применяется).

**🕐 Time of day** (multi-select chips). Фильтр **поверх** выбранного дня (AND-логика).
- `Morning` (06:00–11:59) / `Afternoon` (12:00–17:59) / `Evening` (18:00–22:59)
- Multi-select: ни один не активен = любое время; несколько активны = OR между ними (например `Morning` + `Evening` = матчи с 06:00–11:59 ИЛИ 18:00–22:59 на выбранный день).
- Время дня матча определяется по `match.start_time` **в зоне Europe/Prague** (без duration). В БД `start_time` лежит в UTC — для сравнения с границами окон конвертируем в Prague-локальное время. Матч в 17:55 Prague с длительностью 90 мин = `Afternoon` (не `Evening`). Юзер в другой TZ видит те же границы (всё приложение на Prague-time, см. "Таймзоны" в [match.md](./pitchup-spec-match.md)). Это же правило применяется к самому выбору дня (`?date=YYYY-MM-DD` — это Prague-день, не UTC-день).
- URL: `?time=morning,afternoon,evening` (любая подмножина, comma-separated)

**⚽ Game size** (multi-select chips). Фильтр по формату матча.
- Чипы: `4 a side` / `5 a side` / `6 a side` / `7 a side` / `8 a side` / `9 a side` / `10 a side` / `11 a side`
- **Маппинг — точный:** чип `N a side` ловит матчи где `Math.floor(total_spots / 2) === N`. Без толеранса.
  - `4 a side` = total_spots ∈ {8, 9}
  - `5 a side` = total_spots ∈ {10, 11}
  - `6 a side` = total_spots ∈ {12, 13}
  - `7 a side` = total_spots ∈ {14, 15}
  - `8 a side` = total_spots ∈ {16, 17}
  - `9 a side` = total_spots ∈ {18, 19}
  - `10 a side` = total_spots ∈ {20, 21}
  - `11 a side` = total_spots ∈ {22, 23}
- Матчей с `total_spots < 8` в системе **не существует** — `/matches/new` и PATCH `/matches/:id` отбивают `total_spots < 8` через `400 invalid_total_spots` (см. "Шаг 2" в [match.md](./pitchup-spec-match.md) — минимум stepper'а = 8, чтобы матч не выпадал из чипов `Game size`). Чипы 4..11 a side покрывают весь допустимый диапазон.
- Multi-select: ни один не активен = любой размер; несколько активных = OR.
- URL: `?size=4,5,6,7,8,9,10,11` (comma-separated N от 4 до 11)

**⚡ Spots left** (radio). Фильтр по числу свободных слотов = `computeSlots(match).free` (см. "Slot math" в [global.md](./pitchup-spec-global.md)).
- `Any` (default — показываем включая full) / `1 spot` / `2–3 spots` / `4+ spots`
- Не `Any` = матч с `free > 0` (любой не-`Any` неявно прячет full-матчи). Если юзер хочет "только full" — не делаем в v1.
- URL: `?spots=1|2-3|4+` (отсутствие = Any)

**🆓 Price** (toggle-чекбокс). `Free only` — price = 0.
- URL: `?free=1` (отсутствие = показывать всё)

**✓ Field status** (toggle-чекбокс). `Booked only` — field_booked = true.
- URL: `?booked=1` (отсутствие = показывать всё)

**Что НЕ в sheet'е** (намеренно):
- Hide full отдельной опцией — выражается через `Spots left ≠ Any`.
- Surface фильтр — убран в v1 (слишком мало матчей для значимой фильтрации по покрытию).
- Women-only, Online payment, Favourite venues — таких сущностей в v1 нет.

**Sticky-хром итого:** TopBar (56) + filter bar (56) + day picker (64) + BottomNav (56) = 232px.

**Кнопки:**
| Элемент | Действие |
|---|---|
| Search | live-filter по venue |
| `[⚙]` (filter bar) | открыть bottom-sheet "More filters" |
| `[+ New match]` (filter bar) | → /matches/new (гость → /login?callbackUrl=/matches/new) |
| Day picker cell | single-select — меняет выбранный день, список пересчитывается моментально |
| `[← Today]` (под picker'ом) | возврат к сегодняшнему дню, виден только если выбран не сегодня |
| `[Set location]` (Distance секция в sheet'е) | → /map?pickLocation=true (только если локация не установлена) |
| `[Apply filters]` (sheet) | применить sheet-фильтры и закрыть sheet |
| `[Reset]` (sheet) | сбросить все sheet-фильтры в default в draft state (не применяется автоматически) |
| MatchCard | → /matches/:id |
| BottomNav: Map | → /map (выбранный день + все sheet-фильтры переносятся через URL) |

**URL-параметры** (для shareable filter state и sync между `/games` ↔ `/map`):
- `?date=YYYY-MM-DD` — выбранный день, **интерпретируется в Europe/Prague**. Backend конвертирует в UTC-range `[Prague-midnight start_of_day .. Prague-midnight start_of_next_day)` (т.е. 23 или 25 часов в DST-границах) и фильтрует матчи по `start_time IN range`. Если параметр невалиден / в прошлом по Prague-time / дальше +20 дней — fallback на сегодня (без error-стейта). Максимум = today+20 включительно — симметрично с day picker'ом (21 день начиная с сегодня).
- `?distance=1|3|5|10` — radio из sheet'а. Отсутствие = Any. Если локация не установлена в localStorage — параметр игнорируется (фильтр не применяется).
- `?time=morning,afternoon,evening` — multi-select из sheet'а. Любая подмножина, comma-separated. Отсутствие = любое время.
- `?size=4,5,6,7,8,9,10,11` — multi-select game size из sheet'а. Любая подмножина N от 4 до 11. Отсутствие = любой размер.
- `?spots=1|2-3|4+` — radio из sheet'а. Отсутствие = Any (включая full).
- `?free=1` — toggle из sheet'а. Отсутствие = показывать всё.
- `?booked=1` — toggle из sheet'а. Отсутствие = показывать всё.
- Отсутствие всех параметров = default (сегодня, без фильтров).

**Состояния:**
- **Loading:** 6 skeleton cards
- **Пусто за выбранный день:** "No matches on {Today / Tomorrow / Thursday 21}." + подсказка `Try another day →` (с маленькой стрелкой к picker'у) + `[+ New match]`. Если активны sheet-фильтры — дополнительно `[Clear all filters]` (одна кнопка, удаляет sheet-параметры из URL — как Apply пустого draft'а; день и search не трогает).
- **`?distance=` в URL, локация не установлена:** тонкий info-баннер над списком (под day picker'ом, **не sticky — скрывается со скроллом**): `"Distance filter ignored — set your location to enable it"` + ghost-кнопка `[Set location]` справа. Тап ведёт на `/map?pickLocation=true` (тот же путь что из Distance секции в sheet'е). Баннер закрывается крестиком (`×` справа от кнопки) — на этой сессии больше не появляется (state в memory, не localStorage), при следующем визите снова возникнет если параметр всё ещё в URL и локации всё ещё нет. Сам список рендерится как при отсутствии параметра (фильтр игнорируется тихо — поведение API не меняем, только UI добавляет видимость).

**Pagination:** лимит 50 матчей на запрос (на выбранный день). Если есть ещё — кнопка `[Show more]` внизу списка, грузит следующие 50. Курсор-пагинация по `(start_time ASC, id ASC)`.

**Real-time:** списки `/games` и `/map` **НЕ подписаны на push'и**. Создание / cancel / edit видны только при следующем визите или pull-to-refresh. Слот-счётчики MatchCard обновляются on-read (свежие данные при каждом visit). Это accepted trade-off для MVP.

**Invalid query params fallback:** невалидные значения query (whitelist) для `?distance`, `?time`, `?size`, `?spots`, `?free`, `?booked` — параметр игнорируется, не падаем (поведение симметрично с fallback для `?date=`).

> **Что выпало из фильтров после редизайна (sheet + day picker):** custom date range (Period — только один день за раз), `🔥 Tonight` (≈ Today + sheet's Time of day = Evening, два тапа вместо одного), `📅 Weekend` (Sat/Sun по отдельности), Price=Paid (только Free toggle), фильтр "только full матчи" (Spots left даёт `Any` = включая full, или не-`Any` = только с местами; "только full" не делаем). Это **сознательное упрощение** для v1.

**Cancelled и In progress матчи** на `/games` не показываются — публичный список содержит только матчи со статусом Open / Almost full / Full. In progress матчи видны в `/my-matches` у своих участников и по прямой ссылке `/matches/:id`. См. "Состояния матча" в [match.md](./pitchup-spec-match.md).

---

## `/map` — Карта матчей

Отдельный таб (бывший `?view=map` режим внутри `/discover`). Полноэкранная карта с пинами по venue.

**Layout:**
1. TopBar (лого + 🔔; для гостя — лого + `[Sign in]`).
2. **Sticky filter bar** (поверх карты сверху): тот же что на `/games` — searchbar + `[⚙]` icon-button + `[+ New match]` справа. `[⚙]` открывает bottom-sheet "More filters" (тот же что на `/games`, **без date-фильтра** — на карте даты не фильтруются). Все прочие фильтры (Distance, Time of day, Game size, Spots left, Price, Field status) работают и на карте.
3. **Sticky info-chip strip** (h≈40px, под filter bar, sticky поверх карты). Горизонтальная лента smart-чипов. Если ни один чип не виден — strip скрывается целиком (h=0).
4. **Карта** на full-screen (MapLibre + OSM). BottomNav остаётся sticky поверх карты — пользователь не заперт.

**Info-чипы (v1 — один чип):**

| Чип | Текст | Условие видимости | Источник |
|---|---|---|---|
| `⏰ Next` | `Next HH:MM` (если сегодня) или `Next Mon DD, HH:MM` (если будущий день) | Есть ≥1 матч **из текущей отфильтрованной выборки**. Если фильтры обнулили выборку (или вообще нет матчей в горизонте) — чип скрыт. | Минимальный `match.start_time` среди матчей, прошедших активные sheet-фильтры (Distance, Time of day, Game size, Spots left, Price, Field status), в горизонте 21 дня после `now()` |

> **Чип всегда консистентен с тем что на карте.** Считаем по тому же набору, что рисуем пинами. Если юзер выкрутил Game size=7 — `Next` покажет ближайший 7-a-side матч; тап полетит в пин, который на карте уже видим. Альтернатива (считать по всем матчам, игнорируя фильтры) приводила бы к "чип показывает матч, которого на карте нет" — UX-баг.

> **Зачем v1 = один чип, а не три.** На `/map` info-чипы оправданы только тем, что компенсируют отсутствие сортировки списком — `Next` решает 80% сценария ("куда мне попасть сегодня вечером"). `Closest` и `Last spots` сознательно откладываем до v1.1: добавить чип — 1 час, выкинуть из ленты, если не пошёл — больнее. Лучше дождаться юзер-сигнала.

**Поведение тапа по чипу:**

Алгоритм: вычисляем матчи, удовлетворяющие критерию чипа (для `Next` это **один** матч — самый ранний после `now()` среди отфильтрованной выборки; при равенстве `start_time` берём все совпавшие).

- **Результат = 1 матч:**
  1. Карта плавно центрируется на пине этого матча (`map.flyTo` с zoom ≥ 15, animation ≈300ms).
  2. Открывается тот же bottom-sheet с MatchCard, что при тапе на пин (см. "Пины" ниже). Юзер остаётся на `/map`, закрыл sheet — продолжает листать карту.
  3. Пин в центре кратковременно подсвечивается (pulse ≈600ms) — визуальная связь "чип → этот пин".

- **Результат = N > 1 матчей** (равенство `start_time`, редкий кейс):
  1. Карта не центрируется (равных пинов несколько — куда лететь неясно).
  2. Открывается bottom-sheet со списком MatchCard'ов, отсортированных по `start_time` ASC. Тап на карточку → `/matches/:id` (то же поведение, что для multi-pin sheet'а).

- **Результат = 0 матчей:** чип в этой ситуации скрыт (см. таблицу выше), кейс невозможен.

**Чего тап по чипу НЕ делает:**
- Не меняет URL (sheet — transient state, как и тап по пину).
- Не фильтрует/приглушает остальные пины на карте.
- Не редиректит на `/games` или `/matches/:id`.
- Не toggle'ится — у чипа нет "активного" состояния, повторный тап = повторный центр+sheet того же матча.

**Пины:** цифра = свободных слотов, красный = full. Cancelled и In progress матчи на карте не показываются — только Open / Almost full / Full.

**Тап на пин** → bottom-sheet со всеми upcoming матчами на этом venue в горизонте 21 дня (только Open / Almost full / Full), **отсортированы по `start_time` ASC** — ближайший матч вверху. Тап на карточку → `/matches/:id`. **Swipe up:** если в sheet один матч — навигирует на `/matches/:id`; если несколько — только расширяет sheet до полной высоты (не навигирует).

**Горизонт 21 день — единое правило для всех `/map` подсистем.** `today..today+20` в Prague-day (end_of_day включительно) — применяется одинаково к пинам, venue-sheet и Next-чипу. Симметрично с day picker'ом на `/games`.

**Кнопка `[📍 My location]`** справа снизу:
- **Локация установлена** (GPS или ручной пин) → центрирует карту на сохранённых координатах.
- **Локация не установлена** → открывает Location modal (см. ниже).

**Location modal** (живёт на `/map`, поверх карты):

Появляется:
- При тапе на `[📍 My location]` когда локация не установлена.
- Автоматически при открытии `/map?pickLocation=true` (переход из Distance-CTA в sheet'е `/games`).

Три варианта:
| Кнопка | Действие |
|---|---|
| `[📍 Use my location]` | Запрашивает `navigator.geolocation.getCurrentPosition()`. **Разрешил** → сохраняет `{lat, lng, source: 'gps'}` в localStorage, закрывает модалку. **Отказал** (любой denial — первый, повторный, persistent) → модалка **остаётся открытой**, внутри появляется inline-подсказка `"GPS blocked — try Place on map, or enable location in browser settings."` Кнопка `[📍 Use my location]` остаётся активной (юзер может ретраить — если denial был не persistent, prompt снова всплывёт; если persistent — браузер тихо отдаст ошибку, подсказка повторно отрисуется). Кнопка `[📌 Place on map]` доступна как альтернатива. Никакого автозакрытия модалки на denial — симметрично с подсказкой "что делать дальше", чтобы юзер не остался без объяснения. |
| `[📌 Place on map]` | Закрывает модалку, активирует Pick-location mode (см. ниже). Тап = `history.replaceState` модалки на entry режима (replace, не pop+push) — один экран в history stack всё время. |
| `[Cancel]` | Закрывает модалку без изменений — текущая сохранённая локация (если была) не трогается. Юзер остаётся на `/map` (даже если пришёл через `?pickLocation=true` — автовозврата на `/games` нет, см. Distance секцию). |

**Pick-location mode** (режим выбора точки вручную):

Активируется кнопкой `[📌 Place on map]` в Location modal.
- Поверх карты — баннер сверху: `"Pan to your area, then confirm"` (тонкая полоска, не перекрывает карту).
- В центре экрана — фиксированный крестик/пин (не перемещается — это не drag, пользователь двигает карту под ним).
- Кнопка `[📍 My location]` и Location status chip **скрыты** на время режима — крестик в центре единственное действие.
- Снизу — sticky footer: `[Use this location]` (primary) + `[Cancel]` (ghost).
- `[Use this location]` → сохраняет центр текущего viewport как `{lat, lng, source: 'manual'}` в localStorage. Нет expiry — живёт до замены новой локацией. Выходит из режима, остаётся на `/map` (автовозврата на `/games` нет даже если пришли через `?pickLocation=true`).
- `[Cancel]` → выходит из режима без изменений, остаётся на `/map`.

**Hardware back / swipe-back** (Android back, iOS edge-swipe, browser back):
- Открытие Location modal → push history entry. Back = `[Cancel]` модалки (модалка закрывается, юзер остаётся на `/map`).
- Вход в Pick-location mode → push history entry. Back = `[Cancel]` режима (выход без изменений, юзер остаётся на `/map`).
- Закрытие через UI-кнопку (`[Cancel]`, клик вне модалки, `[Use this location]`) → программный `history.back()` чтобы pop'нуть свою entry. Это гарантирует что back-кнопка дальше работает естественно (следующий back = уход с `/map`).
- Если открыты обе сущности подряд (модалка → `[📌 Place on map]` → Pick-location mode), entries складываются в стек: первый back = выход из Pick-location mode (но модалки уже нет, она закрылась при переходе), второй back = уход с `/map`.

**Location status chip** (когда локация установлена):

Показывается в правом нижнем углу карты, над кнопкой `[📍 My location]`:
- Источник GPS: `📍 GPS`
- Источник manual: `📌 Manual`
- Тап → повторно открывает Location modal (сменить способ или обновить).
- Чип скрыт, если локация не установлена.

**Синхронизация фильтров с `/games`:** sheet-фильтры (`?distance=&time=&size=&spots=&free=&booked=`) переносятся между табами через URL. **`?date=` на `/map` не применяется** — карта показывает все upcoming матчи без фильтра по дню. При переходе `/games → /map` параметр `?date=` отбрасывается. При переходе `/map → /games` применяется дефолт (сегодня). Поисковая строка — ephemeral, в URL не пишется, при смене таба теряется.

**`?pickLocation=true`** — служебный параметр, выставляется только при переходе с CTA `[Set location]` из sheet'а `/games`. При открытии `/map` с этим параметром Location modal открывается автоматически. Если локация **уже** установлена в localStorage — модалка всё равно открывается (полезно для смены способа / обновления пина). Параметр убирается из URL сразу после открытия модалки (не персистентный). **Автовозврата на `/games` нет** — после установки локации (или Cancel) юзер остаётся на `/map` и сам возвращается через BottomNav.

**Геолокация и хранение локации:**
- Координаты хранятся в localStorage как `{lat, lng, source: 'gps' | 'manual'}` — **без expiry**, живут до явной замены (новый GPS-запрос или новый ручной пин).
- GPS-запрос (`getCurrentPosition`) происходит только через Location modal — не автоматически при открытии страницы.
- Отказал в GPS → Location modal закрывается, `[📍 My location]` остаётся активным (можно попробовать снова или выбрать `[📌 Place on map]`). Секция Distance в sheet'е `/games` показывает CTA `[Set location]` пока локация не установлена любым способом.
- Расчёт расстояния — Haversine в SQL (без PostGIS).
- В БД у venues храним `lat`, `lng` (заполняет админ).

**Кнопки:**
| Элемент | Действие |
|---|---|
| Map pin | bottom-sheet с превью матча(ей) |
| MatchCard в bottom-sheet | → /matches/:id |
| `[⚙]` (top bar) | открыть bottom-sheet "More filters" (тот же что на `/games`, без date-фильтра) |
| `[+ New match]` (top bar) | → /matches/new (гость → /login?callbackUrl=/matches/new) |
| Info-чип `⏰ Next` | центрирует карту на пине ближайшего матча + открывает bottom-sheet с MatchCard (при равенстве start_time — sheet со списком). См. "Поведение тапа по чипу" выше. |
| `[📍 My location]` | Локация установлена → центрирует карту. Не установлена → открывает Location modal. |
| Location modal `[📍 Use my location]` | Запрашивает GPS permission, сохраняет в localStorage |
| Location modal `[📌 Place on map]` | Активирует Pick-location mode |
| Location modal `[Cancel]` | Закрывает без изменений |
| `[Use this location]` (Pick-location mode) | Сохраняет центр viewport как ручной пин, выходит из режима |
| Location status chip | Открывает Location modal повторно (сменить / обновить локацию) |
| BottomNav: Games | → /games (sheet-фильтры синхронизированы через URL без `?date=`; info-чипы НЕ переносятся — их на /games нет; дата применяется как сегодня по умолчанию) |

**Состояния:**
- **Loading:** карта рендерится сразу, пины подгружаются — над пинами skeleton placeholder.
- **Пусто (нет матчей в системе в ближайшие 21 день):** небольшая нотификация "No upcoming matches" поверх карты.
- **Пусто (фильтры убрали все матчи):** нотификация "No matches match your filters" поверх карты с `[Reset filters]`.
