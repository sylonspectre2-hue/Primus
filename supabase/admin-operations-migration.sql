begin;

create or replace function public.admin_approve_seller(p_seller_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role public.primus_role;
begin
    if not (select public.is_primus_admin()) then
        raise exception 'Only the administrator can approve sellers.';
    end if;
    select p.role into v_role
    from public.profiles p
    join public.seller_shops s on s.seller_id = p.id
    where p.id = p_seller_id and s.terms_accepted_at is not null
    for update of p, s;
    if not found or v_role <> 'buyer'::public.primus_role then
        raise exception 'This seller application is incomplete, already reviewed, or unavailable.';
    end if;

    update public.profiles set role = 'seller'::public.primus_role where id = p_seller_id;
    insert into public.notifications (user_id, kind, title, body)
    values (p_seller_id, 'seller_application', 'Seller application approved', 'Your Primus seller account is approved. You can now publish products.');
end;
$$;

revoke all on function public.admin_approve_seller(uuid) from public, anon;
grant execute on function public.admin_approve_seller(uuid) to authenticated;

create or replace function public.admin_review_rider_application(p_user_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text;
    v_role public.primus_role;
begin
    if not (select public.is_primus_admin()) then
        raise exception 'Only the administrator can review rider applications.';
    end if;
    if p_user_id is null or p_decision is null or p_decision not in ('approve', 'reject') then
        raise exception 'Choose a valid rider application and decision.';
    end if;

    select a.status, p.role into v_status, v_role
    from public.rider_applications a
    join public.profiles p on p.id = a.user_id
    where a.user_id = p_user_id
    for update of a, p;
    if not found or v_status <> 'pending' or v_role <> 'buyer'::public.primus_role then
        raise exception 'This rider application is incomplete, already reviewed, or unavailable.';
    end if;

    update public.rider_applications
    set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
        reviewed_at = now()
    where user_id = p_user_id;

    if p_decision = 'approve' then
        update public.profiles set role = 'rider'::public.primus_role where id = p_user_id;
        insert into public.notifications (user_id, kind, title, body)
        values (p_user_id, 'rider_application', 'Rider application approved', 'Your Primus rider account is approved. You can now accept assigned deliveries.');
    else
        insert into public.notifications (user_id, kind, title, body)
        values (p_user_id, 'rider_application', 'Rider application update', 'Your Primus rider application was not approved. Contact support if you have questions.');
    end if;
end;
$$;

revoke all on function public.admin_review_rider_application(uuid, text) from public, anon;
grant execute on function public.admin_review_rider_application(uuid, text) to authenticated;

create or replace function public.admin_assign_order_rider(p_order_id uuid, p_rider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order public.orders%rowtype;
begin
    if not (select public.is_primus_admin()) then
        raise exception 'Only the administrator can assign riders.';
    end if;
    if p_order_id is null or p_rider_id is null or not exists (
        select 1
        from public.profiles p
        join public.rider_applications a on a.user_id = p.id
        where p.id = p_rider_id
          and p.role = 'rider'::public.primus_role
          and a.status = 'approved'
    ) then
        raise exception 'Choose an approved rider.';
    end if;

    select * into v_order from public.orders where id = p_order_id for update;
    if not found or v_order.status not in ('preparing', 'assigned') then
        raise exception 'Only an order being prepared or ready for delivery can be assigned.';
    end if;
    if v_order.rider_id = p_rider_id then
        raise exception 'This rider is already assigned to the order.';
    end if;
    if v_order.payment_method = 'mobile_money' and v_order.payment_status <> 'paid' then
        raise exception 'This Mobile Money order is not paid yet.';
    end if;

    update public.orders
    set rider_id = p_rider_id,
        status = case when status = 'preparing' then 'assigned' else status end
    where id = p_order_id;

    insert into public.notifications (user_id, order_id, kind, title, body)
    values
        (v_order.buyer_id, p_order_id, 'rider_assigned', 'Rider assigned', 'A delivery rider has been assigned to your order.'),
        (v_order.seller_id, p_order_id, 'rider_assigned', 'Rider assigned', 'A delivery rider has been assigned to this order.'),
        (p_rider_id, p_order_id, 'delivery_assigned', 'New delivery assignment', 'A Primus order has been assigned to you.');
end;
$$;

revoke all on function public.admin_assign_order_rider(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_order_rider(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
