-- handle_new_user：display_name 改用 coalesce，支援 OAuth（Google 給 full_name/name，無 display_name）。
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, updated_at)
  values (
    new.id,
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
