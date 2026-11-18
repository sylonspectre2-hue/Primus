do $$
begin
    create type public.primus_role as enum ('buyer', 'seller', 'rider', 'admin');
exception
    when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null default '',
    phone_number text not null default '',
    shop_name text not null default '',
    role public.primus_role not null default 'buyer',
    created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists phone_number text not null default '';
alter table public.profiles add column if not exists shop_name text not null default '';

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    buyer_id uuid not null references public.profiles (id),
    seller_id uuid not null references public.profiles (id),
    rider_id uuid references public.profiles (id),
    status text not null default 'preparing'
        check (status in ('preparing', 'assigned', 'out_for_delivery', 'delivered', 'cancelled')),
    created_at timestamptz not null default now()
);

create table if not exists public.order_messages (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    sender_id uuid not null references public.profiles (id),
    body text not null check (char_length(btrim(body)) between 1 and 4000),
    created_at timestamptz not null default now()
);

create table if not exists public.delivery_locations (
    order_id uuid not null references public.orders (id) on delete cascade,
    rider_id uuid not null references public.profiles (id) on delete cascade,
    latitude double precision,
    longitude double precision,
    accuracy_m double precision,
    is_sharing boolean not null default false,
    expires_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (order_id, rider_id),
    check (latitude is null or latitude between -90 and 90),
    check (longitude is null or longitude between -180 and 180),
    check (accuracy_m is null or accuracy_m >= 0),
    check (not is_sharing or (latitude is not null and longitude is not null))
);

create index if not exists orders_buyer_created_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_seller_created_idx on public.orders (seller_id, created_at desc);
create index if not exists orders_rider_status_idx on public.orders (rider_id, status);
create index if not exists order_messages_order_created_idx on public.order_messages (order_id, created_at);

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
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_primus_user();

create or replace function public.is_primus_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'::public.primus_role
    );
$$;

create or replace function public.refresh_delivery_location_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    if new.is_sharing then
        new.expires_at := now() + interval '90 seconds';
    else
        new.latitude := null;
        new.longitude := null;
        new.accuracy_m := null;
        new.expires_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists refresh_delivery_location_expiry on public.delivery_locations;
create trigger refresh_delivery_location_expiry
before insert or update on public.delivery_locations
for each row execute function public.refresh_delivery_location_expiry();

revoke all on function public.handle_new_primus_user() from public, anon, authenticated;
revoke all on function public.refresh_delivery_location_expiry() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_messages enable row level security;
alter table public.delivery_locations enable row level security;

revoke all on public.profiles, public.orders, public.order_messages, public.delivery_locations from anon, authenticated;
revoke all on function public.is_primus_admin() from public, anon;

grant select on public.profiles, public.orders to authenticated;
grant select, insert on public.order_messages to authenticated;
grant select, insert, update on public.delivery_locations to authenticated;
grant execute on function public.is_primus_admin() to authenticated;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_primus_admin()));

drop policy if exists "Order participants read orders" on public.orders;
create policy "Order participants read orders"
on public.orders for select to authenticated
using (
    buyer_id = (select auth.uid())
    or seller_id = (select auth.uid())
    or rider_id = (select auth.uid())
    or (select public.is_primus_admin())
);

drop policy if exists "Order participants read messages" on public.order_messages;
create policy "Order participants read messages"
on public.order_messages for select to authenticated
using (
    (select public.is_primus_admin())
    or exists (
        select 1
        from public.orders o
        where o.id = order_messages.order_id
          and (
              o.buyer_id = (select auth.uid())
              or o.seller_id = (select auth.uid())
              or o.rider_id = (select auth.uid())
          )
    )
);

drop policy if exists "Order participants send messages as themselves" on public.order_messages;
create policy "Order participants send messages as themselves"
on public.order_messages for insert to authenticated
with check (
    sender_id = (select auth.uid())
    and exists (
        select 1
        from public.orders o
        where o.id = order_messages.order_id
          and (
              o.buyer_id = (select auth.uid())
              or o.seller_id = (select auth.uid())
              or o.rider_id = (select auth.uid())
          )
    )
);

drop policy if exists "Riders and assigned order participants read active locations" on public.delivery_locations;
create policy "Riders and assigned order participants read active locations"
on public.delivery_locations for select to authenticated
using (
    is_sharing
    and expires_at > now()
    and exists (
        select 1 from public.orders o
        where o.id = delivery_locations.order_id
          and o.rider_id = delivery_locations.rider_id
          and (
              (o.rider_id = (select auth.uid()) and exists (
                  select 1 from public.profiles p
                  where p.id = (select auth.uid()) and p.role = 'rider'::public.primus_role
              ))
              or o.buyer_id = (select auth.uid())
              or o.seller_id = (select auth.uid())
              or (select public.is_primus_admin())
          )
    )
);

drop policy if exists "Assigned riders start sharing their own location" on public.delivery_locations;
create policy "Assigned riders start sharing their own location"
on public.delivery_locations for insert to authenticated
with check (
    rider_id = (select auth.uid())
    and is_sharing
    and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'rider'::public.primus_role
    )
    and exists (
        select 1 from public.orders o
        where o.id = delivery_locations.order_id
          and o.rider_id = (select auth.uid())
          and o.status = 'out_for_delivery'
    )
);

drop policy if exists "Assigned riders update or stop their own location" on public.delivery_locations;
create policy "Assigned riders update or stop their own location"
on public.delivery_locations for update to authenticated
using (
    rider_id = (select auth.uid())
    and exists (
        select 1 from public.orders o
        where o.id = delivery_locations.order_id and o.rider_id = (select auth.uid())
    )
)
with check (
    rider_id = (select auth.uid())
    and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'rider'::public.primus_role
    )
    and exists (
        select 1 from public.orders o
        where o.id = delivery_locations.order_id
          and o.rider_id = (select auth.uid())
          and (not delivery_locations.is_sharing or o.status = 'out_for_delivery')
    )
);

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_messages'
        ) then
            execute 'alter publication supabase_realtime add table public.order_messages';
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_locations'
        ) then
            execute 'alter publication supabase_realtime add table public.delivery_locations';
        end if;
    end if;
end
$$;
