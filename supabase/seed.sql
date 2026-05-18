-- 1. Generate a hash locally:
--    FAMILY_CHAT_AUTH_PEPPER="your-long-random-pepper" npm run hash-password -- "<family-password>"
-- 2. Paste the generated value below instead of PASTE_GENERATED_HASH_HERE.
-- 3. Put the same FAMILY_CHAT_AUTH_PEPPER into .env.local and Vercel.

insert into public.chats (title, slug, password_hash)
values (
  'Семейный чат',
  'family',
  'PASTE_GENERATED_HASH_HERE'
)
on conflict (slug) do update
set
  title = excluded.title,
  password_hash = excluded.password_hash;

