-- 1. Generate a hash locally:
--    FAMILY_CHAT_AUTH_PEPPER="your-long-random-pepper" npm run hash-password -- family123
-- 2. Paste the generated value below instead of pbkdf2_sha256$310000$xNWvvRx_A8_Ds84TRReyyg$Bw8KS5JTNDRAeI8cRc4ycGnjvdV0P_oz2eyS869S7fE.
-- 3. Put the same FAMILY_CHAT_AUTH_PEPPER into .env.local and Vercel.

insert into public.chats (title, slug, password_hash)
values (
  'РЎРµРјРµР№РЅС‹Р№ С‡Р°С‚',
  'family',
  'pbkdf2_sha256$310000$xNWvvRx_A8_Ds84TRReyyg$Bw8KS5JTNDRAeI8cRc4ycGnjvdV0P_oz2eyS869S7fE'
)
on conflict (slug) do update
set
  title = excluded.title,
  password_hash = excluded.password_hash;

