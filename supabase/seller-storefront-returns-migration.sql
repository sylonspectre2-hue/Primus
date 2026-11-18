alter table public.orders add column if not exists delivered_at timestamptz;

alter table public.order_items
    add column if not exists primus_commission_ugx bigint
    generated always as (round(unit_price_ugx::numeric * quantity * 0.05)::bigint) stored;

create table if not exists public.seller_shops (
    seller_id uuid primary key references public.profiles (id) on delete cascade,
    shop_name text not null check (char_length(btrim(shop_name)) between 2 and 160),
    description text not null default '' check (char_length(description) <= 1000),
    contact_phone text not null check (char_length(btrim(contact_phone)) between 7 and 40),
    district text not null check (char_length(btrim(district)) between 2 and 100),
    city text not null check (char_length(btrim(city)) between 2 and 100),
    area text not null check (char_length(btrim(area)) between 2 and 120),
    address text not null check (char_length(btrim(address)) between 4 and 300),
    terms_version text,
    terms_accepted_at timestamptz,
    is_public boolean not null default true,
    updated_at timestamptz not null default now()
);

alter table public.seller_shops enable row level security;
revoke all on public.seller_shops from public, anon, authenticated;
grant select on public.seller_shops to authenticated;

drop policy if exists "Sellers read their own shop profile" on public.seller_shops;
create policy "Sellers read their own shop profile"
on public.seller_shops for select to authenticated
using (seller_id = (select auth.uid()) or (select public.is_primus_admin()));

create or replace function public.handle_new_primus_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
    insert into public.profiles (id, display_name, phone_number, shop_name)
    values (
        new.id,
        left(coalesce(v_metadata ->> 'display_name', ''), 120),
        left(coalesce(v_metadata ->> 'phone_number', ''), 40),
        left(coalesce(v_metadata ->> 'shop_name', ''), 160)
    )
    on conflict (id) do nothing;

    if v_metadata ->> 'requested_role' = 'seller'
       and v_metadata ->> 'seller_terms_accepted' = 'true'
       and v_metadata ->> 'seller_terms_version' = 'seller-v1-2026-11-19' then
        insert into public.seller_shops (
            seller_id, shop_name, description, contact_phone, district, city, area, address,
            terms_version, terms_accepted_at, is_public
        )
        values (
            new.id,
            left(btrim(coalesce(v_metadata ->> 'shop_name', '')), 160),
            left(coalesce(v_metadata ->> 'shop_description', ''), 1000),
            left(btrim(coalesce(v_metadata ->> 'phone_number', '')), 40),
            left(btrim(coalesce(v_metadata ->> 'shop_district', '')), 100),
            left(btrim(coalesce(v_metadata ->> 'shop_city', '')), 100),
            left(btrim(coalesce(v_metadata ->> 'shop_area', '')), 120),
            left(btrim(coalesce(v_metadata ->> 'shop_address', '')), 300),
            'seller-v1-2026-11-19',
            now(),
            true
        )
        on conflict (seller_id) do nothing;
    end if;
    return new;
end;
$$;

create or replace function public.get_public_seller_shop(p_seller_id uuid)
returns table (
    seller_id uuid,
    shop_name text,
    description text,
    contact_phone text,
    district text,
    city text,
    area text,
    address text
)
language sql
stable
security definer
set search_path = ''
as $$
    select s.seller_id, s.shop_name, s.description, s.contact_phone,
           s.district, s.city, s.area, s.address
    from public.seller_shops s
    join public.profiles p on p.id = s.seller_id
    where s.seller_id = p_seller_id
      and (
          s.is_public
          or exists (
              select 1
              from public.orders o
              where o.seller_id = s.seller_id
                and o.buyer_id = (select auth.uid())
          )
      )
      and p.role in ('seller'::public.primus_role, 'admin'::public.primus_role);
$$;

revoke all on function public.get_public_seller_shop(uuid) from public;
grant execute on function public.get_public_seller_shop(uuid) to anon, authenticated;

create or replace function public.save_seller_shop_profile(
    p_shop_name text,
    p_description text,
    p_contact_phone text,
    p_district text,
    p_city text,
    p_area text,
    p_address text,
    p_is_public boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_role public.primus_role;
begin
    if v_user_id is null then
        raise exception 'Sign in before editing your shop profile.';
    end if;
    select role into v_role from public.profiles where id = v_user_id;
    if v_role is null or v_role not in ('seller'::public.primus_role, 'admin'::public.primus_role) then
        raise exception 'Only approved sellers and the administrator can edit a shop profile.';
    end if;
    if char_length(btrim(coalesce(p_shop_name, ''))) not between 2 and 160
       or char_length(coalesce(p_description, '')) > 1000
       or char_length(btrim(coalesce(p_contact_phone, ''))) not between 7 and 40
       or char_length(btrim(coalesce(p_district, ''))) not between 2 and 100
       or char_length(btrim(coalesce(p_city, ''))) not between 2 and 100
       or char_length(btrim(coalesce(p_area, ''))) not between 2 and 120
       or char_length(btrim(coalesce(p_address, ''))) not between 4 and 300 then
        raise exception 'Enter a valid shop name, contact number, and complete shop location.';
    end if;

    insert into public.seller_shops (
        seller_id, shop_name, description, contact_phone, district, city, area, address, is_public, updated_at
    )
    values (
        v_user_id, btrim(p_shop_name), coalesce(p_description, ''), btrim(p_contact_phone),
        btrim(p_district), btrim(p_city), btrim(p_area), btrim(p_address), coalesce(p_is_public, false), now()
    )
    on conflict (seller_id) do update set
        shop_name = excluded.shop_name,
        description = excluded.description,
        contact_phone = excluded.contact_phone,
        district = excluded.district,
        city = excluded.city,
        area = excluded.area,
        address = excluded.address,
        is_public = excluded.is_public,
        updated_at = now();
    update public.profiles set shop_name = btrim(p_shop_name) where id = v_user_id;
end;
$$;

revoke all on function public.save_seller_shop_profile(text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_seller_shop_profile(text, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.mark_order_delivered(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_role public.primus_role;
    v_order public.orders%rowtype;
begin
    if v_user_id is null then
        raise exception 'Sign in before completing a delivery.';
    end if;
    select role into v_role from public.profiles where id = v_user_id;
    if v_role is null or (v_role <> 'admin'::public.primus_role and v_role <> 'rider'::public.primus_role) then
        raise exception 'Only the assigned rider or administrator can complete this delivery.';
    end if;
    select * into v_order from public.orders where id = p_order_id for update;
    if not found or (v_role <> 'admin'::public.primus_role and v_order.rider_id <> v_user_id) then
        raise exception 'This delivery is not assigned to your account.';
    end if;
    if v_order.status <> 'out_for_delivery' then
        raise exception 'Only an order out for delivery can be marked delivered.';
    end if;
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
end;
$$;

revoke all on function public.mark_order_delivered(uuid) from public, anon;
grant execute on function public.mark_order_delivered(uuid) to authenticated;

create table if not exists public.return_requests (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete restrict,
    order_item_id uuid not null references public.order_items (id) on delete restrict,
    buyer_id uuid not null references public.profiles (id) on delete restrict,
    seller_id uuid not null references public.profiles (id) on delete restrict,
    product_name text not null,
    quantity integer not null check (quantity between 1 and 99),
    reason text not null check (reason in ('changed_mind', 'wrong_item', 'faulty')),
    details text not null default '' check (char_length(details) <= 1000),
    item_value_ugx bigint not null check (item_value_ugx > 0),
    commission_ugx bigint not null check (commission_ugx >= 0),
    refund_amount_ugx bigint not null default 0 check (refund_amount_ugx >= 0),
    resolution text check (resolution in ('refund', 'replacement')),
    status text not null default 'requested'
        check (status in ('requested', 'approved', 'rejected', 'received', 'refund_due', 'replacement_due', 'completed', 'cancelled')),
    seller_response text not null default '' check (char_length(seller_response) <= 1000),
    completion_reference text,
    created_at timestamptz not null default now(),
    received_at timestamptz,
    resolved_at timestamptz
);

create index if not exists return_requests_buyer_created_idx on public.return_requests (buyer_id, created_at desc);
create index if not exists return_requests_seller_created_idx on public.return_requests (seller_id, created_at desc);
create index if not exists return_requests_item_idx on public.return_requests (order_item_id, status);

alter table public.return_requests enable row level security;
revoke all on public.return_requests from public, anon, authenticated;
grant select on public.return_requests to authenticated;

drop policy if exists "Return participants read requests" on public.return_requests;
create policy "Return participants read requests"
on public.return_requests for select to authenticated
using (
    buyer_id = (select auth.uid())
    or seller_id = (select auth.uid())
    or (select public.is_primus_admin())
);

create or replace function public.create_return_request(
    p_order_item_id uuid,
    p_quantity integer,
    p_reason text,
    p_details text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_order_id uuid;
    v_buyer_id uuid;
    v_seller_id uuid;
    v_product_name text;
    v_unit_price bigint;
    v_item_quantity integer;
    v_status text;
    v_delivered_at timestamptz;
    v_requested_quantity integer;
    v_item_value bigint;
    v_commission bigint;
    v_refund bigint;
    v_return_id uuid;
begin
    if v_user_id is null then
        raise exception 'Sign in before requesting a return.';
    end if;
    if p_quantity is null or p_quantity < 1 or p_reason is null or p_reason not in ('changed_mind', 'wrong_item', 'faulty')
       or char_length(coalesce(p_details, '')) > 1000 then
        raise exception 'Enter a valid return reason, quantity, and details.';
    end if;

    select oi.order_id, o.buyer_id, oi.seller_id, oi.product_name, oi.unit_price_ugx, oi.quantity,
           o.status, o.delivered_at
    into v_order_id, v_buyer_id, v_seller_id, v_product_name, v_unit_price, v_item_quantity, v_status, v_delivered_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = p_order_item_id
    for update of oi, o;

    if not found or v_buyer_id <> v_user_id then
        raise exception 'This order item is not available to your account.';
    end if;
    if v_status <> 'delivered' or v_delivered_at is null then
        raise exception 'A return can be requested only after the order is marked delivered.';
    end if;
    if v_delivered_at > now() or now() > v_delivered_at + interval '3 days' then
        raise exception 'The 3-day return request period has ended.';
    end if;
    select coalesce(sum(r.quantity), 0) into v_requested_quantity
    from public.return_requests r
    where r.order_item_id = p_order_item_id
      and r.status not in ('rejected', 'cancelled');
    if p_quantity > v_item_quantity - v_requested_quantity then
        raise exception 'The requested quantity exceeds the remaining eligible items.';
    end if;

    v_item_value := v_unit_price * p_quantity;
    v_commission := round(v_unit_price::numeric * p_quantity * 0.05)::bigint;
    v_refund := case when p_reason = 'changed_mind' then round(v_item_value::numeric * 0.75)::bigint else 0 end;

    insert into public.return_requests (
        order_id, order_item_id, buyer_id, seller_id, product_name, quantity, reason, details,
        item_value_ugx, commission_ugx, refund_amount_ugx
    )
    values (
        v_order_id, p_order_item_id, v_user_id, v_seller_id, v_product_name, p_quantity, p_reason,
        btrim(coalesce(p_details, '')), v_item_value, v_commission, v_refund
    )
    returning id into v_return_id;
    return v_return_id;
end;
$$;

revoke all on function public.create_return_request(uuid, integer, text, text) from public, anon;
grant execute on function public.create_return_request(uuid, integer, text, text) to authenticated;

create or replace function public.cancel_return_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.return_requests
    set status = 'cancelled'
    where id = p_request_id
      and buyer_id = (select auth.uid())
      and status = 'requested';
    if not found then
        raise exception 'Only your pending return request can be cancelled.';
    end if;
end;
$$;

revoke all on function public.cancel_return_request(uuid) from public, anon;
grant execute on function public.cancel_return_request(uuid) to authenticated;

create or replace function public.review_return_request(
    p_request_id uuid,
    p_decision text,
    p_resolution text,
    p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_role public.primus_role;
    v_request public.return_requests%rowtype;
    v_resolution text;
begin
    if v_user_id is null then
        raise exception 'Sign in before reviewing a return request.';
    end if;
    select role into v_role from public.profiles where id = v_user_id;
    if v_role is null or (v_role <> 'admin'::public.primus_role and v_role <> 'seller'::public.primus_role) then
        raise exception 'Only the seller or administrator can review a return request.';
    end if;
    if p_decision is null or p_decision not in ('approve', 'reject') or char_length(coalesce(p_response, '')) > 1000 then
        raise exception 'Enter a valid decision and response.';
    end if;

    select * into v_request from public.return_requests where id = p_request_id for update;
    if not found or (v_role <> 'admin'::public.primus_role and v_request.seller_id <> v_user_id) then
        raise exception 'This return request is not available to your account.';
    end if;
    if v_request.status <> 'requested' then
        raise exception 'This return request has already been reviewed.';
    end if;
    if p_decision = 'reject' then
        update public.return_requests
        set status = 'rejected', seller_response = btrim(coalesce(p_response, ''))
        where id = p_request_id;
        return;
    end if;

    if v_request.reason = 'changed_mind' then
        v_resolution := 'refund';
    elsif p_resolution in ('refund', 'replacement') then
        v_resolution := p_resolution;
    else
        raise exception 'Choose a full item refund or replacement for a wrong or faulty item.';
    end if;
    update public.return_requests
    set status = 'approved',
        resolution = v_resolution,
        refund_amount_ugx = case
            when v_resolution = 'replacement' then 0
            when reason = 'changed_mind' then round(item_value_ugx::numeric * 0.75)::bigint
            else item_value_ugx
        end,
        seller_response = btrim(coalesce(p_response, ''))
    where id = p_request_id;
end;
$$;

revoke all on function public.review_return_request(uuid, text, text, text) from public, anon;
grant execute on function public.review_return_request(uuid, text, text, text) to authenticated;

create or replace function public.confirm_return_received(p_request_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_role public.primus_role;
    v_request public.return_requests%rowtype;
begin
    if v_user_id is null then
        raise exception 'Sign in before confirming a returned item.';
    end if;
    select role into v_role from public.profiles where id = v_user_id;
    if v_role is null or (v_role <> 'admin'::public.primus_role and v_role <> 'seller'::public.primus_role) then
        raise exception 'Only the seller or administrator can confirm receipt.';
    end if;
    if char_length(coalesce(p_note, '')) > 1000 then
        raise exception 'The return note is too long.';
    end if;
    select * into v_request from public.return_requests where id = p_request_id for update;
    if not found or (v_role <> 'admin'::public.primus_role and v_request.seller_id <> v_user_id) then
        raise exception 'This return request is not available to your account.';
    end if;
    if v_request.status <> 'approved' then
        raise exception 'Only an approved return can be marked received.';
    end if;
    update public.return_requests
    set status = case when resolution = 'replacement' then 'replacement_due' else 'refund_due' end,
        received_at = now(),
        seller_response = case when btrim(coalesce(p_note, '')) = '' then seller_response else btrim(p_note) end
    where id = p_request_id;
end;
$$;

revoke all on function public.confirm_return_received(uuid, text) from public, anon;
grant execute on function public.confirm_return_received(uuid, text) to authenticated;

create or replace function public.complete_return_replacement(p_request_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_role public.primus_role;
    v_request public.return_requests%rowtype;
begin
    if v_user_id is null then
        raise exception 'Sign in before completing a replacement.';
    end if;
    select role into v_role from public.profiles where id = v_user_id;
    if v_role is null or (v_role <> 'admin'::public.primus_role and v_role <> 'seller'::public.primus_role) then
        raise exception 'Only the seller or administrator can complete a replacement.';
    end if;
    if char_length(btrim(coalesce(p_reference, ''))) not between 2 and 200 then
        raise exception 'Enter a delivery or handover reference for the replacement.';
    end if;
    select * into v_request from public.return_requests where id = p_request_id for update;
    if not found or (v_role <> 'admin'::public.primus_role and v_request.seller_id <> v_user_id) then
        raise exception 'This return request is not available to your account.';
    end if;
    if v_request.status <> 'replacement_due' then
        raise exception 'This request is not waiting for a replacement.';
    end if;
    update public.return_requests
    set status = 'completed', completion_reference = btrim(p_reference), resolved_at = now()
    where id = p_request_id;
end;
$$;

revoke all on function public.complete_return_replacement(uuid, text) from public, anon;
grant execute on function public.complete_return_replacement(uuid, text) to authenticated;

create or replace function public.confirm_return_refund_paid(p_request_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_request public.return_requests%rowtype;
begin
    if not (select public.is_primus_admin()) then
        raise exception 'Only the administrator can confirm a refund payout.';
    end if;
    if char_length(btrim(coalesce(p_reference, ''))) not between 2 and 200 then
        raise exception 'Enter the payment or cash handover reference.';
    end if;
    select * into v_request from public.return_requests where id = p_request_id for update;
    if not found or v_request.status <> 'refund_due' then
        raise exception 'This request is not waiting for a refund payout.';
    end if;
    update public.return_requests
    set status = 'completed', completion_reference = btrim(p_reference), resolved_at = now()
    where id = p_request_id;
end;
$$;

revoke all on function public.confirm_return_refund_paid(uuid, text) from public, anon;
grant execute on function public.confirm_return_refund_paid(uuid, text) to authenticated;

notify pgrst, 'reload schema';
