begin;

do $$
declare
    v_admin_id uuid;
begin
    select id
    into v_admin_id
    from auth.users
    where lower(email) = lower('sylonspectre2@gmail.com')
      and email_confirmed_at is not null;

    if v_admin_id is null then
        raise exception 'Create and verify the specified account in Supabase Auth before running this script.';
    end if;

    if not exists (
        select 1 from public.profiles where id = v_admin_id
    ) then
        raise exception 'The account profile is missing. Run schema.sql and retry.';
    end if;

    if exists (
        select 1
        from public.profiles
        where role = 'admin'::public.primus_role
          and id <> v_admin_id
    ) then
        raise exception 'Another admin account already exists. Review it before assigning the single-admin role.';
    end if;

    update public.profiles
    set role = 'admin'::public.primus_role
    where id = v_admin_id;
end
$$;

create unique index if not exists profiles_single_admin_idx
    on public.profiles (role)
    where role = 'admin'::public.primus_role;

commit;
