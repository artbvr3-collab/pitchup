# PITCHUP — Функциональная спека (v3.1, разбитая)

> Единственный источник правды по экранам и функциям. Код пишем по этим файлам.
> Спека разбита на 4 файла + этот index. Этот файл — карта, не контент.

---

## Карта файлов

| Файл | Что внутри |
|---|---|
| [pitchup-spec-global.md](./pitchup-spec-global.md) | Глобальные решения, карта сайта, entry-страницы (`/`, `/login`, `/welcome`), глобальные компоненты, error/empty pages, legal, rate-limits, CSRF |
| [pitchup-spec-discovery.md](./pitchup-spec-discovery.md) | `/games`, `/map` |
| [pitchup-spec-match.md](./pitchup-spec-match.md) | `/matches/:id` (все табы, состояния, CTA bar, captain sheet), `/matches/:id/edit`, `/matches/new`, конкурентность и блокировки |
| [pitchup-spec-personal.md](./pitchup-spec-personal.md) | `/my-matches`, `/chats`, `/me`, `/users/:id`, `/admin/*`, известные пробелы, что НЕ делаем в v1 |
| [pitchup-app-map.md](./pitchup-app-map.md) | Краткая карта приложения: роли, экраны, навигация, ERD, cron, "что доступно по статусу" — **производная** от спеки, при конфликте побеждает спека. Audit-checklist в шапке. |

---

## Где искать конкретную тему

### Auth / гость / онбординг
→ [global.md](./pitchup-spec-global.md): Аутентификация · Guard онбординга · Доступ гостя · Бан/удаление аккаунта · `/welcome`

### Модели данных матча
→ [global.md](./pitchup-spec-global.md): Форматы матчей · Покрытие поля · Статус брони · Тип матча · Total spots — hard cap для approve · Гости (+N) · Cover venue

### Уведомления / real-time
→ [global.md](./pitchup-spec-global.md): Уведомления (email, in-app inbox, browser) · Real-time sync (глобальный SSE)
→ [match.md](./pitchup-spec-match.md): Tab Chat (per-match SSE)

### Поиск матчей
→ [discovery.md](./pitchup-spec-discovery.md): `/games` (список + чипы) · `/map` (карта + пины) · геолокация

### Жизненный цикл матча
→ [match.md](./pitchup-spec-match.md): создание (`/matches/new`) · страница (`/matches/:id`) · редактирование (`/matches/:id/edit`) · Join/Leave/Cancel flows · Reject/Kick/Leave flows · состояния (Open/Full/In progress/Ended/Cancelled) · лайки

### Личные экраны
→ [personal.md](./pitchup-spec-personal.md): `/my-matches` (главная залогиненного) · `/chats` · `/me` · `/users/:id`

### Админка
→ [personal.md](./pitchup-spec-personal.md): `/admin/users` · `/admin/matches` · `/admin/venues` · `/admin/reports` · Hide text (модерация)

### UI-кит
→ [global.md](./pitchup-spec-global.md): TopBar · BottomNav · MatchCard · PlayerChip · Loading · Error/empty

### Что осознанно НЕ делаем / пробелы
→ [personal.md](./pitchup-spec-personal.md): Известные пробелы · Что НЕ делаем в v1

---

## Правила работы со спекой

- **Cross-references внутри файла** — текстом ("см. 'Покрытие поля' выше").
- **Cross-references между файлами** — текстом + ссылкой на файл ("см. 'Покрытие поля' в [global.md](./pitchup-spec-global.md)").
- **При правке** — сначала ищи существующий раздел, не дублируй. Если тема пересекает файлы — фиксируй в одном месте, в других ставь короткую ссылку.
- **Новые разделы** — добавляй в файл по теме, не в index. Index обновляй только если добавил новую тему верхнего уровня.
