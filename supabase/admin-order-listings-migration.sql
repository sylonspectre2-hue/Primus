create or replace function public.create_marketplace_order(
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

notify pgrst, 'reload schema';
