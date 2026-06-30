-- profiles.username 之前全為 NULL（handle_new_user 只填 display_name，從未寫 username）。
-- 依需求填入 email 的「@ 前綴」(local-part)。username 為 UNIQUE VarChar(32)，
-- 故回填與 trigger 都做去重，避免：① 回填時撞唯一鍵讓 migration 失敗；② 新註冊撞名讓 trigger throw 而擋住整個註冊。

-- 1) 回填現有 NULL：同前綴用 row_number 去重，第 2 筆起加序號後綴（截到 32 字內）。
WITH candidates AS (
  SELECT
    p.id,
    left(split_part(u.email, '@', 1), 32) AS base,
    row_number() OVER (
      PARTITION BY left(split_part(u.email, '@', 1), 32)
      ORDER BY p.created_at, p.id
    ) AS rn
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.username IS NULL
)
UPDATE public.profiles p
SET username = CASE
                 WHEN c.base IS NULL OR c.base = '' THEN 'user-' || left(replace(p.id::text, '-', ''), 12)
                 WHEN c.rn = 1 THEN c.base
                 ELSE left(c.base, 26) || '-' || c.rn::text
               END
FROM candidates c
WHERE p.id = c.id;

-- 2) 新用戶自動帶 username = email 前綴；撞名才加 id 短碼，保證唯一、不擋註冊。
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_base text := left(split_part(new.email, '@', 1), 32);
  v_username text;
begin
  if v_base is null or v_base = '' then
    -- 無 email（少數情況）：用 id 造唯一值，仍保證非 NULL。
    v_username := 'user-' || left(replace(new.id::text, '-', ''), 12);
  elsif exists (select 1 from public.profiles where username = v_base) then
    -- 撞名：截到 23 字 + '-' + id 8 碼（23+1+8=32，符合 VarChar(32)）。
    -- ponytail: 仍有極小機率同毫秒兩筆同前綴的 race，量大再改為迴圈/序號；現階段足夠。
    v_username := left(v_base, 23) || '-' || left(replace(new.id::text, '-', ''), 8);
  else
    v_username := v_base;
  end if;

  insert into public.profiles (id, username, display_name, updated_at)
  values (
    new.id,
    v_username,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
