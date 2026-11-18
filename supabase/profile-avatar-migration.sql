begin;

alter table public.profiles
    add column if not exists avatar_id text not null default 'orbit';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_avatar_id_check'
    ) then
        alter table public.profiles
            add constraint profiles_avatar_id_check
            check (avatar_id in ('orbit', 'sunrise', 'leaf', 'waves', 'mountain', 'spark', 'bloom', 'bolt'));
    end if;
end
$$;

revoke update on public.profiles from anon, authenticated;
revoke update (avatar_id) on public.profiles from anon, authenticated;

drop policy if exists "Users update their own editable profile fields" on public.profiles;
create policy "Users update their own editable profile fields"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create or replace function public.update_primus_avatar(p_avatar_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Authentication is required to update a profile icon.'
            using errcode = '42501';
    end if;

    if p_avatar_id is null
       or p_avatar_id not in ('orbit', 'sunrise', 'leaf', 'waves', 'mountain', 'spark', 'bloom', 'bolt') then
        raise exception 'The selected profile icon is not supported.'
            using errcode = '22023';
    end if;

    update public.profiles
    set avatar_id = p_avatar_id
    where id = (select auth.uid());

    if not found then
        raise exception 'The signed-in profile could not be found.'
            using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.update_primus_avatar(text) from public, anon, authenticated;
grant execute on function public.update_primus_avatar(text) to authenticated;

commit;

notify pgrst, 'reload schema';
