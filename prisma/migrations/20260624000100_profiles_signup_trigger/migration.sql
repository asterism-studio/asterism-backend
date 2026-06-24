-- 註冊時自動在 public.profiles 建對應列。
-- updated_at 是 Prisma @updatedAt（DB 層無 default），raw insert 必須明給，否則違反 NOT NULL。
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, updated_at)
  values (new.id, new.raw_user_meta_data->>'display_name', now())
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
