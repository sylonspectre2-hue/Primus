alter table public.products add column if not exists image_urls text[] not null default '{}';
alter table public.products add column if not exists specifications jsonb not null default '{}'::jsonb;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'products_image_urls_limit'
          and conrelid = 'public.products'::regclass
    ) then
        alter table public.products
            add constraint products_image_urls_limit check (cardinality(image_urls) <= 10);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'products_specifications_object'
          and conrelid = 'public.products'::regclass
    ) then
        alter table public.products
            add constraint products_specifications_object check (jsonb_typeof(specifications) = 'object');
    end if;
end
$$;

drop policy if exists "Admins create products" on public.products;
create policy "Admins create products"
on public.products for insert to authenticated
with check (
    (select public.is_primus_admin())
    and seller_id = (select auth.uid())
);

drop policy if exists "Admins update products" on public.products;
create policy "Admins update products"
on public.products for update to authenticated
using ((select public.is_primus_admin()))
with check ((select public.is_primus_admin()));

drop policy if exists "Admins delete products" on public.products;
create policy "Admins delete products"
on public.products for delete to authenticated
using ((select public.is_primus_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'product-images',
    'product-images',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view product images" on storage.objects;
create policy "Anyone can view product images"
on storage.objects for select to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "Sellers and admins upload product images" on storage.objects;
create policy "Sellers and admins upload product images"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role in ('seller'::public.primus_role, 'admin'::public.primus_role)
    )
);

drop policy if exists "Sellers and admins update product images" on storage.objects;
create policy "Sellers and admins update product images"
on storage.objects for update to authenticated
using (
    bucket_id = 'product-images'
    and (
        (storage.foldername(name))[1] = (select auth.uid())::text
        or (select public.is_primus_admin())
    )
)
with check (
    bucket_id = 'product-images'
    and (
        (storage.foldername(name))[1] = (select auth.uid())::text
        or (select public.is_primus_admin())
    )
);

drop policy if exists "Sellers and admins delete product images" on storage.objects;
create policy "Sellers and admins delete product images"
on storage.objects for delete to authenticated
using (
    bucket_id = 'product-images'
    and (
        (storage.foldername(name))[1] = (select auth.uid())::text
        or (select public.is_primus_admin())
    )
);
