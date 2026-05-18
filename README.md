# Семейный чат

Приватный семейный веб-чат на Next.js и Supabase: вход по общему паролю, участники с PIN, текстовые сообщения, фото, быстрые emoji, удаление своих сообщений, онлайн-статусы, список участников, даты в истории, счетчик новых сообщений, устойчивая локальная сессия и PWA-иконка для главного экрана телефона.

## Бесплатные инструменты

- Next.js / React / TypeScript
- Supabase Free: Postgres + Realtime
- Vercel Free
- GitHub
- PWA manifest + service worker без платных сервисов

## Локальный запуск

```bash
npm install
cp .env.example .env.local
npm run dev
```

Откройте `http://localhost:3000`.

## Переменные окружения

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
FAMILY_CHAT_SLUG=family
FAMILY_CHAT_SESSION_SECRET=replace-with-a-long-random-secret
FAMILY_CHAT_AUTH_PEPPER=replace-with-a-long-random-pepper
```

Не добавляйте `.env.local` в GitHub.

## Настройка Supabase

1. Создайте бесплатный проект в Supabase.
2. В SQL Editor выполните `supabase/schema.sql`.
3. Добавьте `FAMILY_CHAT_AUTH_PEPPER` в `.env.local`.
4. Сгенерируйте hash пароля:

```bash
FAMILY_CHAT_AUTH_PEPPER="тот-же-pepper" npm run hash-password -- "<семейный-пароль>"
```

5. Вставьте hash в `supabase/seed.sql` вместо `PASTE_GENERATED_HASH_HERE`.
6. Выполните `supabase/seed.sql` в SQL Editor.
7. В Project Settings → API возьмите URL, anon key и service role key.

## Supabase Realtime

В `supabase/schema.sql` уже есть:

```sql
alter publication supabase_realtime add table public.messages;
```

Если Supabase скажет, что таблица уже добавлена, это нормально. Проверьте в Dashboard → Database → Replication, что `messages` включена для Realtime.

Ограничение MVP 0: обычные чтение и запись идут через backend/API route после парольной сессии. Realtime-подписка использует публичный anon key и включается в интерфейсе после входа. Для более строгой production-модели без публичного realtime-доступа нужен следующий шаг: Supabase Auth/JWT или серверный realtime-шлюз.

## Очистка истории

Правило продукта:

> История хранится 15 дней, чтобы чат оставался лёгким, быстрым и приватным.

SQL-функция `cleanup_family_chat_messages()` удаляет сообщения старше 15 дней и оставляет только последние 1000 сообщений на чат.

Вручную:

```sql
select public.cleanup_family_chat_messages();
```

Через приложение после входа можно вызвать:

```bash
curl -X POST http://localhost:3000/api/cleanup
```

Для расписания на Supabase Free можно запускать вручную или подключить внешний бесплатный cron, который дергает защищенный endpoint после отдельного service-token доработки. В MVP 0 полноценный cron не добавлен.

## Проверка в двух вкладках

1. Запустите проект.
2. Откройте сайт в двух вкладках или на двух устройствах.
3. Введите семейный пароль, который передан участникам отдельно.
4. Создайте участника с именем и PIN из 4 цифр или войдите в существующего участника по имени и PIN.
5. Отправьте текст, emoji или фото в первой вкладке.
6. Во второй вкладке сообщение должно появиться без перезагрузки; в списке участников должны обновляться онлайн-статусы.
7. Проверьте удаление своего сообщения, разделители дат и сохранение входа после обновления страницы.

## PWA и иконки

Manifest находится в `public/manifest.json`.

Иконки взяты из ассета проекта `assets/Cozy_home_with_heart_and_chat_bubble.png` и положены в `public/icons`.

Кнопка «Добавить на телефон»:

- Android/Chrome: использует `beforeinstallprompt`, если браузер разрешил установку.
- iPhone/Safari: показывает инструкцию, потому что автоматическая установка обычно недоступна.

## Деплой на Vercel

1. Загрузите проект на GitHub.
2. Создайте новый проект на Vercel из GitHub-репозитория.
3. Добавьте все переменные окружения из `.env.local`.
4. Build command: `npm run build`.
5. Output оставьте стандартным для Next.js.
6. Deploy.

## Архитектура

- `app/page.tsx` — mobile-first UI входа, PIN-участников, чата, фото, emoji, удаления, списка участников и PWA-инструкции.
- `app/api/auth` — проверка пароля на сервере, без отдачи `password_hash` клиенту.
- `app/api/members` — создание и восстановление участника по PIN, обновление `last_seen_at` и `last_read_at`.
- `app/api/messages` — серверные чтение, отправка текста, подготовка загрузки фото и мягкое удаление сообщений.
- `app/api/cleanup` — cron-ready ручка для очистки истории.
- `lib/password.ts` — PBKDF2 hash/verify с server-side pepper.
- `lib/member-pin.ts` — hash/verify PIN участников.
- `lib/session.ts` — signed-cookie сессия входа в общий чат.
- `supabase/schema.sql` — таблицы, индексы, realtime publication, cleanup-функция и приватный Storage bucket для фото.
- `supabase/seed.sql` — создание одного семейного чата.

## Ограничения

Не реализованы видео, голосовые, файлы кроме фото, аватарки, роли, админка, несколько чатов, email, Telegram, push-уведомления, оплата, календарь и мобильные приложения через App Store / Google Play.
