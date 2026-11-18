begin;

alter table public.return_requests
    add column if not exists automated_refund_status text not null default 'not_started'
        check (automated_refund_status in ('not_started', 'processing', 'pending', 'succeeded', 'failed', 'unknown')),
    add column if not exists flutterwave_refund_id text,
    add column if not exists flutterwave_refund_reference text,
    add column if not exists failure_message text not null default ''
        check (char_length(failure_message) <= 500);

create table if not exists public.seller_payout_destinations (
    seller_id uuid primary key references public.profiles (id) on delete cascade,
    beneficiary_name text not null check (char_length(btrim(beneficiary_name)) between 2 and 120),
    network text not null check (network in ('MTN', 'AIRTEL')),
    phone_number text not null check (phone_number ~ '^2567[0-9]{8}$'),
    terms_version text not null,
    terms_accepted_at timestamptz not null,
    verified_at timestamptz,
    verified_by uuid references public.profiles (id),
    updated_at timestamptz not null default now(),
    check ((verified_at is null) = (verified_by is null))
);

alter table public.seller_payout_destinations
    add column if not exists terms_version text,
    add column if not exists terms_accepted_at timestamptz;

alter table public.seller_payout_destinations enable row level security;
revoke all on public.seller_payout_destinations from public, anon, authenticated;
grant select on public.seller_payout_destinations to authenticated;

drop policy if exists "Sellers and admin read payout destinations" on public.seller_payout_destinations;
create policy "Sellers and admin read payout destinations"
on public.seller_payout_destinations for select to authenticated
using (seller_id = (select auth.uid()) or (select public.is_primus_admin()));

create or replace function public.save_seller_payout_destination(
    p_beneficiary_name text,
    p_network text,
    p_phone_number text,
    p_terms_accepted boolean,
    p_terms_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_role public.primus_role;
    v_phone text := regexp_replace(coalesce(p_phone_number, ''), '[^0-9]', '', 'g');
begin
    if v_user_id is null then
        raise exception 'Sign in before saving payout details.';
    end if;
    select role into v_role from public.profiles where id = v_user_id;
    if v_role is distinct from 'seller'::public.primus_role then
        raise exception 'Only approved sellers can save payout details.';
    end if;
    if p_terms_accepted is distinct from true or p_terms_version is distinct from 'seller-v2-2026-11-19' then
        raise exception 'Accept the updated seller commission and payout terms before saving payout details.';
    end if;
    if char_length(btrim(coalesce(p_beneficiary_name, ''))) not between 2 and 120
       or p_network is null or p_network not in ('MTN', 'AIRTEL')
       or v_phone !~ '^2567[0-9]{8}$' then
        raise exception 'Enter the account holder name, MTN or Airtel, and a valid Uganda mobile number.';
    end if;

    insert into public.seller_payout_destinations (
        seller_id, beneficiary_name, network, phone_number, terms_version, terms_accepted_at
    )
    values (
        v_user_id, btrim(p_beneficiary_name), p_network, v_phone, p_terms_version, now()
    )
    on conflict (seller_id) do update set
        beneficiary_name = excluded.beneficiary_name,
        network = excluded.network,
        phone_number = excluded.phone_number,
        terms_version = excluded.terms_version,
        terms_accepted_at = excluded.terms_accepted_at,
        verified_at = null,
        verified_by = null,
        updated_at = now();
end;
$$;

revoke all on function public.save_seller_payout_destination(text, text, text, boolean, text) from public, anon;
grant execute on function public.save_seller_payout_destination(text, text, text, boolean, text) to authenticated;

create or replace function public.admin_verify_seller_payout_destination(p_seller_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not (select public.is_primus_admin()) then
        raise exception 'Only the administrator can verify payout details.';
    end if;
    update public.seller_payout_destinations
    set verified_at = now(), verified_by = (select auth.uid()), updated_at = now()
    where seller_id = p_seller_id
      and terms_version = 'seller-v2-2026-11-19'
      and terms_accepted_at is not null;
    if not found then
        raise exception 'Payout details were not found for this seller.';
    end if;
end;
$$;

revoke all on function public.admin_verify_seller_payout_destination(uuid) from public, anon;
grant execute on function public.admin_verify_seller_payout_destination(uuid) to authenticated;

create table if not exists public.seller_settlements (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null unique references public.orders (id) on delete restrict,
    seller_id uuid not null references public.profiles (id) on delete restrict,
    gross_ugx bigint not null check (gross_ugx > 0),
    commission_ugx bigint not null check (commission_ugx >= 0),
    refunds_ugx bigint not null check (refunds_ugx >= 0),
    amount_ugx bigint not null check (amount_ugx > 0),
    status text not null default 'ready' check (status in ('ready', 'processing', 'pending', 'paid', 'failed', 'unknown')),
    transfer_id text,
    transfer_reference text unique,
    failure_message text not null default '' check (char_length(failure_message) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    paid_at timestamptz
);

create index if not exists seller_settlements_seller_created_idx
    on public.seller_settlements (seller_id, created_at desc);

alter table public.seller_settlements enable row level security;
revoke all on public.seller_settlements from public, anon, authenticated;
grant select on public.seller_settlements to authenticated;

drop policy if exists "Sellers and admin read settlements" on public.seller_settlements;
create policy "Sellers and admin read settlements"
on public.seller_settlements for select to authenticated
using (seller_id = (select auth.uid()) or (select public.is_primus_admin()));

create or replace function public.admin_create_seller_settlement(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order public.orders%rowtype;
    v_gross bigint;
    v_commission bigint;
    v_refunds bigint;
    v_amount bigint;
    v_settlement_id uuid;
begin
    if not (select public.is_primus_admin()) then
        raise exception 'Only the administrator can create seller settlements.';
    end if;
    select * into v_order from public.orders where id = p_order_id for update;
    if not found or v_order.status <> 'delivered' or v_order.delivered_at is null
       or v_order.delivered_at > now() - interval '3 days' then
        raise exception 'Settlements are available only after delivery and the 3-day return window.';
    end if;
    if v_order.payment_method <> 'mobile_money' or v_order.payment_status <> 'paid' then
        raise exception 'Only verified Flutterwave Mobile Money orders are eligible for automatic settlement.';
    end if;
    if exists (
        select 1 from public.return_requests r
        where r.order_id = p_order_id
          and r.status in ('requested', 'approved', 'received', 'refund_due', 'replacement_due')
    ) then
        raise exception 'Resolve all open return requests before settling this order.';
    end if;
    select coalesce(sum(i.line_total_ugx), 0),
           coalesce(sum(i.primus_commission_ugx), 0)
    into v_gross, v_commission
    from public.order_items i
    where i.order_id = p_order_id;
    select coalesce(sum(r.refund_amount_ugx), 0)
    into v_refunds
    from public.return_requests r
    where r.order_id = p_order_id
      and r.status = 'completed'
      and r.resolution = 'refund';
    v_amount := v_gross - v_commission - v_refunds;
    if v_gross <= 0 or v_amount <= 0 then
        raise exception 'This order has no positive seller balance to settle.';
    end if;

    insert into public.seller_settlements (order_id, seller_id, gross_ugx, commission_ugx, refunds_ugx, amount_ugx)
    values (p_order_id, v_order.seller_id, v_gross, v_commission, v_refunds, v_amount)
    on conflict (order_id) do nothing
    returning id into v_settlement_id;
    if v_settlement_id is null then
        raise exception 'A settlement already exists for this order.';
    end if;
    return v_settlement_id;
end;
$$;

revoke all on function public.admin_create_seller_settlement(uuid) from public, anon;
grant execute on function public.admin_create_seller_settlement(uuid) to authenticated;

create or replace function public.claim_flutterwave_return_refund(p_request_id uuid)
returns table(return_id uuid, transaction_id text, refund_amount_ugx bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order_id uuid;
    v_amount bigint;
    v_transaction_id text;
begin
    if coalesce((select auth.role()), '') <> 'service_role' then
        raise exception 'This operation is available only to the payment service.';
    end if;

    update public.return_requests r
    set automated_refund_status = 'processing'
    from public.orders o
    where r.id = p_request_id
      and r.order_id = o.id
      and r.status = 'refund_due'
      and r.resolution = 'refund'
      and r.refund_amount_ugx > 0
      and r.automated_refund_status = 'not_started'
      and o.payment_method = 'mobile_money'
      and o.payment_status = 'paid'
    returning r.order_id, r.refund_amount_ugx into v_order_id, v_amount;
    if not found then
        raise exception 'This return is not eligible for a new Flutterwave refund.';
    end if;

    select p.provider_transaction_id into v_transaction_id
    from public.payment_attempts p
    where p.order_id = v_order_id
      and p.provider = 'flutterwave'
      and p.status = 'succeeded'
      and p.provider_transaction_id is not null
    order by p.created_at desc
    limit 1;
    if v_transaction_id is null or v_transaction_id !~ '^[0-9]+$' then
        raise exception 'The original Flutterwave transaction could not be found.';
    end if;

    return query select p_request_id, v_transaction_id, v_amount;
end;
$$;

revoke all on function public.claim_flutterwave_return_refund(uuid) from public, anon, authenticated;
grant execute on function public.claim_flutterwave_return_refund(uuid) to service_role;

create or replace function public.record_flutterwave_return_refund(
    p_request_id uuid,
    p_refund_id text,
    p_reference text,
    p_status text,
    p_failure_message text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buyer_id uuid;
begin
    if coalesce((select auth.role()), '') <> 'service_role' then
        raise exception 'This operation is available only to the payment service.';
    end if;
    if p_status is null or p_status not in ('pending', 'succeeded', 'failed', 'unknown') then
        raise exception 'Invalid Flutterwave refund status.';
    end if;
    update public.return_requests
    set automated_refund_status = p_status,
        flutterwave_refund_id = coalesce(nullif(p_refund_id, ''), flutterwave_refund_id),
        flutterwave_refund_reference = coalesce(nullif(p_reference, ''), flutterwave_refund_reference),
        failure_message = left(coalesce(p_failure_message, ''), 500),
        status = case when p_status = 'succeeded' then 'completed' else status end,
        completion_reference = case when p_status = 'succeeded' then coalesce(nullif(p_reference, ''), completion_reference) else completion_reference end,
        resolved_at = case when p_status = 'succeeded' then now() else resolved_at end
    where id = p_request_id
      and status in ('refund_due', 'completed')
      and resolution = 'refund'
      and automated_refund_status <> 'succeeded'
    returning buyer_id into v_buyer_id;
    if not found then
        raise exception 'The return request is no longer waiting for a Flutterwave refund.';
    end if;
    if p_status = 'succeeded' then
        insert into public.notifications (user_id, order_id, kind, title, body)
        select v_buyer_id, order_id, 'refund_completed', 'Refund completed', 'Flutterwave confirmed your refund payout.'
        from public.return_requests
        where id = p_request_id;
    end if;
end;
$$;

revoke all on function public.record_flutterwave_return_refund(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_flutterwave_return_refund(uuid, text, text, text, text) to service_role;

create or replace function public.claim_flutterwave_seller_transfer(p_settlement_id uuid)
returns table(settlement_id uuid, seller_id uuid, amount_ugx bigint, network text, phone_number text, beneficiary_name text, transfer_reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_seller_id uuid;
    v_amount bigint;
    v_network text;
    v_phone text;
    v_name text;
    v_reference text := 'PRIMUS-' || upper(replace(gen_random_uuid()::text, '-', ''));
begin
    if coalesce((select auth.role()), '') <> 'service_role' then
        raise exception 'This operation is available only to the payment service.';
    end if;

    select s.seller_id, s.amount_ugx, d.network, d.phone_number, d.beneficiary_name
    into v_seller_id, v_amount, v_network, v_phone, v_name
    from public.seller_settlements s
    join public.seller_payout_destinations d on d.seller_id = s.seller_id and d.verified_at is not null
    where s.id = p_settlement_id and s.status = 'ready'
      and d.terms_version = 'seller-v2-2026-11-19'
      and d.terms_accepted_at is not null
    for update of s;
    if not found then
        raise exception 'No ready settlement with a verified payout destination was found.';
    end if;

    update public.seller_settlements
    set status = 'processing', transfer_reference = v_reference, failure_message = '', updated_at = now()
    where id = p_settlement_id;
    return query select p_settlement_id, v_seller_id, v_amount, v_network, v_phone, v_name, v_reference;
end;
$$;

revoke all on function public.claim_flutterwave_seller_transfer(uuid) from public, anon, authenticated;
grant execute on function public.claim_flutterwave_seller_transfer(uuid) to service_role;

create or replace function public.record_flutterwave_seller_transfer(
    p_settlement_id uuid,
    p_transfer_id text,
    p_status text,
    p_failure_message text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_seller_id uuid;
begin
    if coalesce((select auth.role()), '') <> 'service_role' then
        raise exception 'This operation is available only to the payment service.';
    end if;
    if p_status is null or p_status not in ('pending', 'paid', 'failed', 'unknown') then
        raise exception 'Invalid Flutterwave transfer status.';
    end if;
    update public.seller_settlements
    set status = p_status,
        transfer_id = coalesce(nullif(p_transfer_id, ''), transfer_id),
        failure_message = left(coalesce(p_failure_message, ''), 500),
        paid_at = case when p_status = 'paid' then now() else paid_at end,
        updated_at = now()
    where id = p_settlement_id and status in ('processing', 'pending', 'unknown')
    returning seller_id into v_seller_id;
    if not found then
        raise exception 'This seller settlement is not waiting for a Flutterwave transfer update.';
    end if;
    if p_status = 'paid' then
        insert into public.notifications (user_id, order_id, kind, title, body)
        select v_seller_id, order_id, 'seller_settlement_paid', 'Seller settlement sent', 'Flutterwave confirmed your settlement transfer.'
        from public.seller_settlements
        where id = p_settlement_id;
    end if;
end;
$$;

revoke all on function public.record_flutterwave_seller_transfer(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_flutterwave_seller_transfer(uuid, text, text, text) to service_role;

create or replace function public.handle_new_primus_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_terms_version text := coalesce(new.raw_user_meta_data ->> 'seller_terms_version', '');
begin
    insert into public.profiles (id, display_name, phone_number, shop_name)
    values (
        new.id,
        left(coalesce(v_metadata ->> 'display_name', ''), 120),
        left(coalesce(v_metadata ->> 'phone_number', ''), 40),
        left(coalesce(v_metadata ->> 'shop_name', ''), 160)
    )
    on conflict (id) do nothing;

    if v_metadata ->> 'requested_role' = 'rider' then
        insert into public.rider_applications (user_id)
        values (new.id)
        on conflict (user_id) do nothing;
    end if;

    if v_metadata ->> 'requested_role' = 'seller'
       and v_metadata ->> 'seller_terms_accepted' = 'true'
       and v_terms_version in ('seller-v1-2026-11-19', 'seller-v2-2026-11-19') then
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
            v_terms_version,
            now(),
            true
        )
        on conflict (seller_id) do nothing;
    end if;

    return new;
end;
$$;

revoke all on function public.handle_new_primus_user() from public, anon, authenticated;

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
    if v_request.automated_refund_status in ('processing', 'pending', 'unknown') then
        raise exception 'Reconcile the in-progress Flutterwave refund before recording a manual payout.';
    end if;
    update public.return_requests
    set status = 'completed', completion_reference = btrim(p_reference), resolved_at = now()
    where id = p_request_id;
end;
$$;

revoke all on function public.confirm_return_refund_paid(uuid, text) from public, anon;
grant execute on function public.confirm_return_refund_paid(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
