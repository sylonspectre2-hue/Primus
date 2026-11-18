begin;

create table if not exists public.rider_applications (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    submitted_at timestamptz not null default now(),
    reviewed_at timestamptz
);

alter table public.rider_applications enable row level security;

revoke all on public.rider_applications from anon, authenticated;
grant select, update on public.rider_applications to authenticated;

drop policy if exists "Users read their own rider applications" on public.rider_applications;
create policy "Users read their own rider applications"
on public.rider_applications for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Admins read rider applications" on public.rider_applications;
create policy "Admins read rider applications"
on public.rider_applications for select to authenticated
using (public.is_primus_admin());

drop policy if exists "Admins review rider applications" on public.rider_applications;
create policy "Admins review rider applications"
on public.rider_applications for update to authenticated
using (public.is_primus_admin())
with check (public.is_primus_admin());

create or replace function public.handle_new_primus_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name, phone_number, shop_name)
    values (
        new.id,
        left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120),
        left(coalesce(new.raw_user_meta_data ->> 'phone_number', ''), 40),
        left(coalesce(new.raw_user_meta_data ->> 'shop_name', ''), 160)
    )
    on conflict (id) do nothing;

    if new.raw_user_meta_data ->> 'requested_role' = 'rider' then
        insert into public.rider_applications (user_id)
        values (new.id)
        on conflict (user_id) do nothing;
    end if;

    return new;
end;
$$;

revoke all on function public.handle_new_primus_user() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
