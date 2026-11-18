create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references public.profiles (id) on delete restrict,
    seller_name text not null check (char_length(btrim(seller_name)) between 2 and 160),
    name text not null check (char_length(btrim(name)) between 2 and 160),
    description text not null default '' check (char_length(description) <= 5000),
    category text not null check (char_length(btrim(category)) between 2 and 80),
    price_ugx bigint not null check (price_ugx > 0),
    stock integer not null default 0 check (stock >= 0),
    image_url text not null check (image_url ~ '^https://'),
    image_urls text[] not null default '{}',
    specifications jsonb not null default '{}'::jsonb,
    is_published boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_vector tsvector generated always as (
        to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(seller_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))
    ) stored
);

alter table public.products add column if not exists image_urls text[] not null default '{}';
alter table public.products add column if not exists specifications jsonb not null default '{}'::jsonb;

create index if not exists products_search_vector_idx on public.products using gin (search_vector);
create index if not exists products_active_category_price_idx on public.products (category, price_ugx) where is_published;
create index if not exists products_seller_created_idx on public.products (seller_id, created_at desc);

alter table public.orders add column if not exists total_ugx bigint not null default 0;
alter table public.orders add column if not exists payment_method text not null default 'cash_on_delivery';
alter table public.orders add column if not exists payment_status text not null default 'pending';
alter table public.orders add column if not exists recipient_name text not null default '';
alter table public.orders add column if not exists recipient_phone text not null default '';
alter table public.orders add column if not exists address_line text not null default '';
alter table public.orders add column if not exists delivery_city text not null default '';
alter table public.orders add column if not exists delivery_note text not null default '';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'orders_total_ugx_check') then
        alter table public.orders add constraint orders_total_ugx_check check (total_ugx >= 0);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_check') then
        alter table public.orders add constraint orders_payment_method_check check (payment_method in ('cash_on_delivery', 'mobile_money'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check') then
        alter table public.orders add constraint orders_payment_status_check check (payment_status in ('pending', 'processing', 'paid', 'failed', 'refunded'));
    end if;
end
$$;

create table if not exists public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    product_id uuid references public.products (id) on delete set null,
    seller_id uuid not null references public.profiles (id) on delete restrict,
    product_name text not null,
    unit_price_ugx bigint not null check (unit_price_ugx > 0),
    quantity integer not null check (quantity between 1 and 99),
    line_total_ugx bigint generated always as (unit_price_ugx * quantity) stored,
    created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_seller_idx on public.order_items (seller_id, created_at desc);

create table if not exists public.buyer_addresses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    label text not null default 'Home' check (char_length(btrim(label)) between 1 and 40),
    recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 120),
    phone text not null check (char_length(btrim(phone)) between 7 and 40),
    address_line text not null check (char_length(btrim(address_line)) between 4 and 300),
    city text not null check (char_length(btrim(city)) between 2 and 100),
    delivery_note text not null default '' check (char_length(delivery_note) <= 500),
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists buyer_addresses_user_idx on public.buyer_addresses (user_id, is_default desc, created_at desc);

create table if not exists public.payment_attempts (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    buyer_id uuid not null references public.profiles (id) on delete cascade,
    provider text not null,
    provider_reference text,
    provider_transaction_id text,
    amount_ugx bigint not null check (amount_ugx > 0),
    status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.payment_attempts add column if not exists provider_transaction_id text;
create index if not exists payment_attempts_order_idx on public.payment_attempts (order_id, created_at desc);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    order_id uuid references public.orders (id) on delete cascade,
    kind text not null check (char_length(btrim(kind)) between 1 and 80),
    title text not null check (char_length(btrim(title)) between 1 and 160),
    body text not null default '' check (char_length(body) <= 1000),
    created_at timestamptz not null default now(),
    read_at timestamptz
);

create table if not exists public.seller_conversations (
    id uuid primary key default gen_random_uuid(),
    buyer_id uuid not null references public.profiles (id) on delete cascade,
    seller_id uuid not null references public.profiles (id) on delete cascade,
    product_id uuid references public.products (id) on delete set null,
    product_name text not null,
    seller_name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (buyer_id, seller_id, product_id),
    check (buyer_id <> seller_id)
);

create table if not exists public.seller_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.seller_conversations (id) on delete cascade,
    sender_id uuid not null references public.profiles (id) on delete cascade,
    body text not null check (char_length(btrim(body)) between 1 and 4000),
    created_at timestamptz not null default now()
);

alter table public.notifications
    add column if not exists conversation_id uuid references public.seller_conversations (id) on delete cascade;

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists seller_conversations_buyer_updated_idx on public.seller_conversations (buyer_id, updated_at desc);
create index if not exists seller_conversations_seller_updated_idx on public.seller_conversations (seller_id, updated_at desc);
create index if not exists seller_messages_conversation_created_idx on public.seller_messages (conversation_id, created_at);

alter table public.products enable row level security;
alter table public.order_items enable row level security;
alter table public.buyer_addresses enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.notifications enable row level security;
alter table public.seller_conversations enable row level security;
alter table public.seller_messages enable row level security;

revoke all on public.products, public.order_items, public.buyer_addresses, public.payment_attempts, public.notifications, public.seller_conversations, public.seller_messages from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.order_items to authenticated;
grant select, insert, update, delete on public.buyer_addresses to authenticated;
grant select on public.payment_attempts to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.seller_conversations to authenticated;
grant select, insert on public.seller_messages to authenticated;
grant select on public.orders to authenticated;

drop policy if exists "Anyone can browse published products" on public.products;
create policy "Anyone can browse published products"
on public.products for select to anon, authenticated
using (
    is_published
    or seller_id = (select auth.uid())
);

drop policy if exists "Admins read all products" on public.products;
create policy "Admins read all products"
on public.products for select to authenticated
using ((select public.is_primus_admin()));

drop policy if exists "Approved sellers create their products" on public.products;
create policy "Approved sellers create their products"
on public.products for insert to authenticated
with check (
    seller_id = (select auth.uid())
    and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'seller'::public.primus_role
    )
);

drop policy if exists "Approved sellers update their products" on public.products;
create policy "Approved sellers update their products"
on public.products for update to authenticated
using (
    seller_id = (select auth.uid())
    and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'seller'::public.primus_role
    )
)
with check (
    seller_id = (select auth.uid())
    and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'seller'::public.primus_role
    )
);

drop policy if exists "Approved sellers delete their products" on public.products;
create policy "Approved sellers delete their products"
on public.products for delete to authenticated
using (
    seller_id = (select auth.uid())
    and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'seller'::public.primus_role
    )
);

drop policy if exists "Participants read order items" on public.order_items;
create policy "Participants read order items"
on public.order_items for select to authenticated
using (
    (select public.is_primus_admin())
    or exists (
        select 1 from public.orders o
        where o.id = order_items.order_id
          and (
              o.buyer_id = (select auth.uid())
              or o.seller_id = (select auth.uid())
              or o.rider_id = (select auth.uid())
          )
    )
);

drop policy if exists "Users manage their own addresses" on public.buyer_addresses;
create policy "Users manage their own addresses"
on public.buyer_addresses for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Buyers and sellers read their payment attempts" on public.payment_attempts;
create policy "Buyers and sellers read their payment attempts"
on public.payment_attempts for select to authenticated
using (
    buyer_id = (select auth.uid())
    or exists (
        select 1 from public.orders o
        where o.id = payment_attempts.order_id
          and o.seller_id = (select auth.uid())
          and (o.payment_method = 'cash_on_delivery' or o.payment_status = 'paid')
    )
    or (select public.is_primus_admin())
);

drop policy if exists "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users mark their own notifications read" on public.notifications;
create policy "Users mark their own notifications read"
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Participants read seller conversations" on public.seller_conversations;
create policy "Participants read seller conversations"
on public.seller_conversations for select to authenticated
using (
    buyer_id = (select auth.uid())
    or seller_id = (select auth.uid())
);

drop policy if exists "Participants read seller messages" on public.seller_messages;
create policy "Participants read seller messages"
on public.seller_messages for select to authenticated
using (
    exists (
        select 1 from public.seller_conversations conversation
        where conversation.id = seller_messages.conversation_id
          and (
              conversation.buyer_id = (select auth.uid())
              or conversation.seller_id = (select auth.uid())
          )
    )
);

drop policy if exists "Participants send seller messages as themselves" on public.seller_messages;
create policy "Participants send seller messages as themselves"
on public.seller_messages for insert to authenticated
with check (
    sender_id = (select auth.uid())
    and exists (
        select 1 from public.seller_conversations conversation
        where conversation.id = seller_messages.conversation_id
          and (
              conversation.buyer_id = (select auth.uid())
              or conversation.seller_id = (select auth.uid())
          )
    )
);

create or replace function public.get_or_create_seller_conversation(p_product_id uuid)
returns table(conversation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buyer_id uuid := (select auth.uid());
    v_seller_id uuid;
    v_product_name text;
    v_seller_name text;
    v_conversation_id uuid;
begin
    if v_buyer_id is null then
        raise exception 'Sign in before messaging a seller.';
    end if;

    select p.seller_id, p.name, p.seller_name
    into v_seller_id, v_product_name, v_seller_name
    from public.products p
    join public.profiles seller on seller.id = p.seller_id
        and seller.role = 'seller'::public.primus_role
    where p.id = p_product_id
      and p.is_published;

    if not found then
        raise exception 'This product is no longer available.';
    end if;
    if v_seller_id = v_buyer_id then
        raise exception 'You cannot message yourself about your own listing.';
    end if;

    insert into public.seller_conversations (
        buyer_id, seller_id, product_id, product_name, seller_name
    )
    values (v_buyer_id, v_seller_id, p_product_id, v_product_name, v_seller_name)
    on conflict (buyer_id, seller_id, product_id) do nothing
    returning id into v_conversation_id;

    if v_conversation_id is null then
        select conversation.id into v_conversation_id
        from public.seller_conversations conversation
        where conversation.buyer_id = v_buyer_id
          and conversation.seller_id = v_seller_id
          and conversation.product_id = p_product_id;
    end if;

    return query select v_conversation_id;
end;
$$;

revoke all on function public.get_or_create_seller_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_seller_conversation(uuid) to authenticated;

drop function if exists public.create_marketplace_order(jsonb, jsonb);
drop function if exists public.create_marketplace_order(jsonb, jsonb, text);

create function public.create_marketplace_order(
    p_items jsonb,
    p_shipping jsonb,
    p_payment_method text default 'cash_on_delivery'
)
returns table(order_id uuid, seller_id uuid, total_ugx bigint, provider_reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_item jsonb;
    v_product_id uuid;
    v_quantity integer;
    v_seller_id uuid;
    v_order_id uuid;
    v_product record;
    v_locked_product record;
    v_total bigint;
    v_created_count integer := 0;
    v_line_count integer;
    v_valid_product_count integer;
    v_provider_reference text;
begin
    if v_user_id is null then
        raise exception 'Sign in before placing an order.';
    end if;
    if p_payment_method is null or p_payment_method not in ('cash_on_delivery', 'mobile_money') then
        raise exception 'Choose a supported payment method.';
    end if;
    if p_payment_method = 'mobile_money' then
        v_provider_reference := 'primus-' || gen_random_uuid()::text;
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'The cart must be a list of products.';
    end if;
    if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
        raise exception 'The cart must contain between 1 and 50 items.';
    end if;
    if p_shipping is null or jsonb_typeof(p_shipping) <> 'object' then
        raise exception 'A delivery address is required.';
    end if;
    if char_length(btrim(coalesce(p_shipping ->> 'recipient_name', ''))) not between 1 and 120
        or char_length(btrim(coalesce(p_shipping ->> 'recipient_phone', ''))) not between 7 and 40
        or char_length(btrim(coalesce(p_shipping ->> 'address_line', ''))) not between 4 and 300
        or char_length(btrim(coalesce(p_shipping ->> 'delivery_city', ''))) not between 2 and 100
        or char_length(coalesce(p_shipping ->> 'delivery_note', '')) > 500 then
        raise exception 'Complete the delivery name, phone, address, and city before placing the order.';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            or coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
            raise exception 'A cart item is invalid.';
        end if;
        v_quantity := (v_item ->> 'quantity')::integer;
        if v_quantity < 1 or v_quantity > 99 then
            raise exception 'Each quantity must be between 1 and 99.';
        end if;
    end loop;

    if exists (
        select 1
        from jsonb_array_elements(p_items) as input(value)
        group by (input.value ->> 'product_id')::uuid
        having sum((input.value ->> 'quantity')::integer) > 99
    ) then
        raise exception 'The maximum quantity per product is 99.';
    end if;

    select count(distinct (input.value ->> 'product_id')::uuid)
    into v_line_count
    from jsonb_array_elements(p_items) as input(value);

    select count(distinct p.id)
    into v_valid_product_count
    from jsonb_array_elements(p_items) as input(value)
    join public.products p on p.id = (input.value ->> 'product_id')::uuid and p.is_published
    join public.profiles seller on seller.id = p.seller_id
        and seller.role in ('seller'::public.primus_role, 'admin'::public.primus_role);

    if v_line_count <> v_valid_product_count then
        raise exception 'One or more products are no longer available.';
    end if;

    for v_seller_id in
        select distinct p.seller_id
        from jsonb_array_elements(p_items) as input(value)
        join public.products p on p.id = (input.value ->> 'product_id')::uuid and p.is_published
        join public.profiles seller on seller.id = p.seller_id
            and seller.role in ('seller'::public.primus_role, 'admin'::public.primus_role)
        order by p.seller_id
    loop
        insert into public.orders (
            buyer_id, seller_id, status, payment_method, payment_status,
            recipient_name, recipient_phone, address_line, delivery_city, delivery_note
        )
        values (
            v_user_id, v_seller_id, 'preparing', p_payment_method,
            case when p_payment_method = 'mobile_money' then 'processing' else 'pending' end,
            btrim(p_shipping ->> 'recipient_name'),
            btrim(p_shipping ->> 'recipient_phone'),
            btrim(p_shipping ->> 'address_line'),
            btrim(p_shipping ->> 'delivery_city'),
            btrim(coalesce(p_shipping ->> 'delivery_note', ''))
        )
        returning id into v_order_id;

        v_total := 0;
        for v_product in
            select p.id, p.name, p.price_ugx, sum((input.value ->> 'quantity')::integer)::integer as quantity
            from jsonb_array_elements(p_items) as input(value)
            join public.products p on p.id = (input.value ->> 'product_id')::uuid
            where p.seller_id = v_seller_id and p.is_published
            group by p.id
            order by p.id
        loop
            select p.id, p.name, p.price_ugx, p.stock
            into v_locked_product
            from public.products p
            where p.id = v_product.id and p.seller_id = v_seller_id and p.is_published
            for update;

            if not found then
                raise exception 'A product is no longer available.';
            end if;
            if v_locked_product.stock < v_product.quantity then
                raise exception 'Not enough stock for %.', v_locked_product.name;
            end if;

            update public.products
            set stock = stock - v_product.quantity, updated_at = now()
            where id = v_locked_product.id;

            insert into public.order_items (order_id, product_id, seller_id, product_name, unit_price_ugx, quantity)
            values (v_order_id, v_locked_product.id, v_seller_id, v_locked_product.name, v_locked_product.price_ugx, v_product.quantity);
            v_total := v_total + v_locked_product.price_ugx * v_product.quantity;
        end loop;

        update public.orders o set total_ugx = v_total where o.id = v_order_id;
        if p_payment_method = 'mobile_money' then
            insert into public.payment_attempts (
                order_id, buyer_id, provider, provider_reference, amount_ugx
            )
            values (v_order_id, v_user_id, 'flutterwave', v_provider_reference, v_total);
        else
            insert into public.notifications (user_id, order_id, kind, title, body)
            values
                (v_user_id, v_order_id, 'order_created', 'Order placed', 'Your order has been sent to the seller. Payment is due on delivery.'),
                (v_seller_id, v_order_id, 'order_created', 'New order', 'A buyer has placed an order. Review it in your seller dashboard.');
        end if;

        v_created_count := v_created_count + 1;
        return query select v_order_id, v_seller_id, v_total, v_provider_reference;
    end loop;

    if v_created_count = 0 then
        raise exception 'No active products were found in this cart.';
    end if;
end;
$$;

revoke all on function public.create_marketplace_order(jsonb, jsonb, text) from public, anon;
grant execute on function public.create_marketplace_order(jsonb, jsonb, text) to authenticated;

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
        update public.products p
        set stock = p.stock + items.quantity, updated_at = now()
        from public.order_items items
        where items.order_id = new.id
          and items.product_id = p.id;
    end if;

    if new.status is distinct from old.status and new.payment_status <> 'failed' then
        insert into public.notifications (user_id, order_id, kind, title, body)
        values
            (new.buyer_id, new.id, 'order_status', 'Order update', 'Your order status is now ' || replace(new.status, '_', ' ') || '.'),
            (new.seller_id, new.id, 'order_status', 'Order update', 'Order status is now ' || replace(new.status, '_', ' ') || '.');
    end if;
    return new;
end;
$$;

revoke all on function public.notify_order_status_change() from public, anon, authenticated;
drop trigger if exists notify_primus_order_status_change on public.orders;
create trigger notify_primus_order_status_change
after update of status on public.orders
for each row execute function public.notify_order_status_change();

create or replace function public.notify_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.payment_status is distinct from new.payment_status and new.payment_status = 'paid' then
        insert into public.notifications (user_id, order_id, kind, title, body)
        values
            (new.buyer_id, new.id, 'payment_confirmed', 'Payment confirmed', 'Your Mobile Money payment has been confirmed.'),
            (new.seller_id, new.id, 'order_created', 'New paid order', 'A buyer has paid for an order. Review it in your seller dashboard.');
    end if;
    return new;
end;
$$;

revoke all on function public.notify_payment_status_change() from public, anon, authenticated;
drop trigger if exists notify_primus_payment_status_change on public.orders;
create trigger notify_primus_payment_status_change
after update of payment_status on public.orders
for each row execute function public.notify_payment_status_change();

create or replace function public.update_seller_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order public.orders%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in before updating an order.';
    end if;
    if not exists (
        select 1 from public.profiles
        where id = (select auth.uid()) and role = 'seller'::public.primus_role
    ) then
        raise exception 'Only approved sellers can update seller orders.';
    end if;
    if p_status is null or p_status not in ('assigned', 'out_for_delivery', 'cancelled') then
        raise exception 'This order status is not available to sellers.';
    end if;

    select * into v_order
    from public.orders
    where id = p_order_id and seller_id = (select auth.uid())
    for update;

    if not found then
        raise exception 'Order not found for this seller.';
    end if;
    if v_order.payment_method = 'mobile_money' and v_order.payment_status <> 'paid' then
        raise exception 'This Mobile Money order is not paid yet.';
    end if;
    if not (
        (v_order.status = 'preparing' and p_status in ('assigned', 'cancelled'))
        or (v_order.status = 'assigned' and p_status in ('out_for_delivery', 'cancelled'))
    ) then
        raise exception 'This status change is not allowed from the current order state.';
    end if;
    if p_status = 'out_for_delivery' and v_order.rider_id is null then
        raise exception 'Assign a rider before marking this order out for delivery.';
    end if;

    update public.orders set status = p_status where id = p_order_id;
end;
$$;

revoke all on function public.update_seller_order_status(uuid, text) from public, anon;
grant execute on function public.update_seller_order_status(uuid, text) to authenticated;

drop policy if exists "Order participants read orders" on public.orders;
create policy "Order participants read orders"
on public.orders for select to authenticated
using (
    (select public.is_primus_admin())
    or buyer_id = (select auth.uid())
    or (
        rider_id = (select auth.uid())
        and (payment_method = 'cash_on_delivery' or payment_status = 'paid')
    )
    or (
        seller_id = (select auth.uid())
        and (payment_method = 'cash_on_delivery' or payment_status = 'paid')
    )
);

create or replace function public.notify_order_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.notifications (user_id, order_id, kind, title, body)
    select participant_id, new.order_id, 'order_message', 'New order message', left(new.body, 240)
    from (
        select o.buyer_id as participant_id from public.orders o where o.id = new.order_id
        union
        select o.seller_id from public.orders o where o.id = new.order_id
        union
        select o.rider_id from public.orders o where o.id = new.order_id
    ) participants
    where participant_id is not null and participant_id <> new.sender_id;
    return new;
end;
$$;

revoke all on function public.notify_order_message() from public, anon, authenticated;
drop trigger if exists notify_primus_order_message on public.order_messages;
create trigger notify_primus_order_message
after insert on public.order_messages
for each row execute function public.notify_order_message();

create or replace function public.notify_seller_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conversation public.seller_conversations%rowtype;
begin
    select * into v_conversation
    from public.seller_conversations
    where id = new.conversation_id;

    if not found then
        raise exception 'Seller conversation not found.';
    end if;

    update public.seller_conversations
    set updated_at = now()
    where id = new.conversation_id;

    insert into public.notifications (user_id, conversation_id, kind, title, body)
    values (
        case when new.sender_id = v_conversation.buyer_id then v_conversation.seller_id else v_conversation.buyer_id end,
        new.conversation_id,
        'seller_message',
        'New product message',
        left(new.body, 240)
    );
    return new;
end;
$$;

revoke all on function public.notify_seller_message() from public, anon, authenticated;
drop trigger if exists notify_primus_seller_message on public.seller_messages;
create trigger notify_primus_seller_message
after insert on public.seller_messages
for each row execute function public.notify_seller_message();

revoke all on function public.handle_new_primus_user() from public, anon, authenticated;
revoke all on function public.refresh_delivery_location_expiry() from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
        ) then
            execute 'alter publication supabase_realtime add table public.products';
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
        ) then
            execute 'alter publication supabase_realtime add table public.notifications';
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seller_messages'
        ) then
            execute 'alter publication supabase_realtime add table public.seller_messages';
        end if;
    end if;
end
$$;
