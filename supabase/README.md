# Supabase setup

The static Primus frontend uses Supabase Auth, Postgres Row Level Security, and Realtime for product and order messaging and rider location sharing. The client loads `@supabase/supabase-js` v2 from `esm.sh`, so the browser needs network access to that package host and to your Supabase project.

## Configure a project

1. Create a Supabase project and open its SQL Editor.
2. Run [`schema.sql`](./schema.sql) to create profiles, orders, messaging, delivery locations, policies, and Realtime publication entries.
3. Run [`commerce-migration.sql`](./commerce-migration.sql) to add seller listings, search, inventory, addresses, checkout orders, and notifications.
4. Run [`product-catalog-migration.sql`](./product-catalog-migration.sql) to enable detailed product specifications, multi-image listings, and the product image storage bucket. Each listing supports up to 10 JPEG, PNG, WebP, or AVIF photos (5 MB each). Sellers can manage their own products; the admin can manage all listings.
5. Run [`profile-avatar-migration.sql`](./profile-avatar-migration.sql) to enable saved avatar choices. It updates avatars through a restricted RPC and does not grant browser clients permission to update profile-table columns.
6. Run [`rider-application-migration.sql`](./rider-application-migration.sql) to save rider sign-ups as pending applications without granting rider privileges automatically.
7. Run [`seller-storefront-returns-migration.sql`](./seller-storefront-returns-migration.sql) to save seller shop location and terms consent, expose approved public storefronts, record the 5% commission per order item, and enable the secure return workflow. This migration requires the schema and commerce migrations.
8. Run [`admin-operations-migration.sql`](./admin-operations-migration.sql) to enable seller/rider application review and rider assignment from the admin pages. It requires the seller storefront and rider application migrations.
9. Run [`flutterwave-payouts-migration.sql`](./flutterwave-payouts-migration.sql) to enable private seller payout destinations, verified-order settlements, and refund/transfer records. It requires the commerce, seller storefront/returns, and rider application migrations. It also updates the signup trigger to preserve both seller storefront creation and rider applications, and to accept the current seller-terms version.
10. In **Project Settings → API**, copy the project URL and the **publishable key** (or legacy anon key) into `assets/js/supabase-config.js`:

   ```js
   window.PRIMUS_SUPABASE_CONFIG = {
       url: 'https://YOUR-PROJECT.supabase.co',
       publishableKey: 'YOUR-PUBLISHABLE-KEY'
   };
   ```

   Never put a `service_role` or `sb_secret_...` key in this browser file.
11. In **Authentication → URL Configuration**, set the local development site URL and allow the password-reset redirect, for example `http://localhost:8000/pages/auth/reset-password.html`. Add your deployed site origin and reset path before production use.
12. Serve the project from `http://localhost` or HTTPS. Browser authentication and geolocation do not work reliably from a `file://` URL.

## Accounts and orders

Public registration creates a buyer profile and stores the submitted name and phone number. Seller registration additionally records the shop's public contact/location and accepted seller-terms version, but it does not grant seller privileges. Once the admin operations migration is applied, review complete seller applications in **Administration → Seller Applications** and rider applications in **Administration → Rider Applications**. Approval changes the protected profile role and sends an account notification; browser metadata cannot grant a role.

Use `seller` or `buyer` only when appropriate. Keep the profile `admin` role restricted to trusted administrators; role changes must never be accepted from browser metadata. Approved sellers can manage and publish listings from **Seller dashboard → Products**. The admin can manage all listings from **Administration → Product Management**.

Approved sellers can edit their public shop information from **Seller dashboard → Shop Profile**. The storefront at `pages/mini-shops/shop-page.html?seller=<seller-profile-id>` exposes the shop's full address, contact phone, and published products. Do not enter private information in these public fields.

## Returns, refunds, and commission

The return workflow is enabled by `seller-storefront-returns-migration.sql`:

- The assigned rider marks an order delivered from **Rider dashboard → Active Delivery**. The database records the delivery time; a buyer can request a return for up to 3 days afterward.
- The buyer submits a request from **My Refund Requests** or the delivered order's details. The seller reviews it and confirms physical receipt at the shop.
- Change-of-mind returns are refunded at 75% of item value, excluding delivery fees. For wrong or faulty items, the seller chooses a full item-value refund or a replacement.
- For eligible paid Mobile Money orders, an administrator can initiate a partial Flutterwave refund from **Administration → Refund Management** and check its final provider status. The return is marked complete only after Flutterwave confirms successful payout. Cash-on-delivery refunds remain manually paid and recorded.
- Flutterwave refunds and seller transfers are server-only through `supabase/functions/flutterwave-payouts`; never put the Flutterwave secret key in browser code. An unknown provider response must be reconciled in the Flutterwave dashboard before any retry.
- The database records the original 5% Primus commission on each order-item line. For eligible Mobile Money orders, the admin settlement amount is gross item value minus that commission and completed item refunds; commission is not reversed. Cash-on-delivery collection and commission settlement remain manual.
- Seller payouts support Uganda MTN and Airtel Mobile Money destinations. Sellers accept the current commission and payout terms when saving their details under **Seller dashboard → Settlements**; changing details requires administrator verification again. An administrator must verify the beneficiary and number before a transfer can be initiated. Sellers with older terms must resave their details and accept the current terms before becoming eligible for automatic settlements.

Refunds and transfers use the Flutterwave available balance and require a Flutterwave account enabled for these operations. Start in Test mode, verify provider responses, and configure webhook reconciliation before production use.

The **Become a Delivery Partner** page links to a Supabase-backed rider registration form. Sign-ups create a pending row in `public.rider_applications`; approval is manual review in **Administration → Rider Applications**. Admins assign approved riders to paid or cash-on-delivery orders from **Administration → Delivery Management**. The database prevents assigning unapproved riders or unpaid Mobile Money orders.

Create and verify the designated administrator account in Supabase Auth, then run [`bootstrap-admin.sql`](./bootstrap-admin.sql) in the SQL Editor. This script promotes only that verified account and creates a database constraint that prevents a second admin role. It contains no password: set credentials through Supabase Auth and rotate any password that has been shared in chat. Admin access is determined by the protected `profiles.role` field and applies on subsequent sign-ins.

The shared navigation account menu links to profile, role-specific orders/settings, messages, tracking, and (for the admin role) the admin dashboard. Users can choose and save one of eight built-in SVG profile icons from **Buyer dashboard → My Profile**. The account menu and profile editor read roles from the database; browser account metadata cannot grant admin permissions.

If saving an avatar reports that `public.update_primus_avatar(p_avatar_id)` could not be found in the schema cache, open the Supabase project's **SQL Editor**, run the full `profile-avatar-migration.sql` script, wait for it to finish successfully, and reload Primus. The migration sends a PostgREST schema-cache reload notification after it commits. Confirm the SQL Editor is open on the same Supabase project configured in `assets/js/supabase-config.js`.

Buyers can search published products, message a seller from a product detail page, save a delivery address, and place cash-on-delivery or Flutterwave Mobile Money orders. Product conversations are private to the buyer and seller. The database checks product availability and stock when creating orders. Each order is grouped by seller; online orders remain hidden from sellers until their payment is verified. Provider secrets must never be put in browser code.

Products owned by the administrator account are valid marketplace listings too. If `commerce-migration.sql` was already applied to your Supabase project, run [`admin-order-listings-migration.sql`](./admin-order-listings-migration.sql) once in the SQL Editor so buyers can order admin-owned listings.

Participants can open **Messages** or **Track delivery** for an order. When the assigned rider is sharing location, buyers see the latest GPS coordinates, update time, and accuracy, and can choose to open that position in OpenStreetMap. The map link is user-initiated; coordinates are not automatically sent to the map provider. A rider must be assigned through a trusted administrative process before sharing live location from the rider's Active Delivery or Navigation page. Sharing stops when the rider presses Stop, leaves the page, or the tab becomes hidden. A location expires after 90 seconds without an update; stopping clears its coordinates. Only current order participants and administrators can read a currently shared location. Messages and location access are enforced by database RLS, not by the page UI alone.

## Flutterwave Mobile Money sandbox

Checkout supports cash on delivery and [Flutterwave Mobile Money for Uganda](https://flutterwave.com/gb/support/payment-methods/pay-with-mobile-money) (MTN or Airtel). The payment flow creates pending orders, reserves inventory, sends the charge request from a Supabase Edge Function, and only exposes paid orders to sellers after the server verifies the transaction reference, currency, and amount. A failed payment cancels the pending orders and restores reserved inventory. The browser never receives the Flutterwave secret key.

1. Apply the updated `commerce-migration.sql` after `schema.sql`.
2. Create or access a [Flutterwave account](https://flutterwave.com/), enable Test mode, and get the test secret key from its dashboard. Follow Flutterwave's Uganda onboarding and sandbox instructions; never paste secret keys into chat or put them in browser files.
3. Deploy `supabase/functions/flutterwave-payment` with the Supabase CLI linked to this project:

   ```text
   supabase functions deploy flutterwave-payment
   ```

4. Deploy `supabase/functions/flutterwave-payouts` for administrator-only refunds and seller transfers:

   ```text
   supabase functions deploy flutterwave-payouts
   ```

5. In **Supabase Dashboard → Edge Functions → Secrets**, set `FLW_SECRET_KEY` to the Flutterwave test secret key and `SITE_URL` to the full site base URL (for GitHub Pages, include the repository path, e.g. `https://OWNER.github.io/REPOSITORY/`). Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Do not expose or paste the service-role key.
6. Test using Flutterwave's Test mode and Uganda test payer details. Complete a checkout with MTN and Airtel where available, approve the prompt, then use **I've approved it — check status**. Confirm verified orders become eligible, failed attempts release inventory, a return refund stays pending until provider confirmation, and a seller transfer is only marked paid after Flutterwave reports `SUCCESSFUL`. Never test money movement with live credentials.

The checkout function verifies status when the buyer checks it; it does not rely on browser redirects as proof of payment. The payouts function uses Flutterwave's [refund API](https://flutterwave-developer-docs-v4-prod.f4b-flutterwave.com/docs/payment-operations/refunds) and [Mobile Money transfer API](https://flutterwave-developer-docs-v4-prod.f4b-flutterwave.com/docs/payout-outflow/mobile-money-transfer). It does not retry unknown operations: reconcile by provider reference before taking further action. Keep Flutterwave in Test mode until credentials, test transactions, and production onboarding have been reviewed.

## Before launch

- Configure production Auth site and redirect URLs for the GitHub Pages base path.
- Run all migrations in order, then create the single admin through `bootstrap-admin.sql`.
- Test seller approval, inventory, checkout, order visibility, and notifications with dedicated test accounts before launch.
- Deploy both Edge Functions with production-only Flutterwave secrets, then test successful, declined, pending, and mismatched-amount transactions before accepting real payments.
- Review the policies and retention requirements for your deployment. No production Supabase project or cross-device flow has been configured or tested as part of this source change.

## GitHub Pages deployment

The repository-root workflow at [`../.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml) deploys the static site on pushes to `main`. The repository root must be this `primus-marketplace` folder because the workflow publishes `index.html`, `pages/`, `assets/`, and `data/`.

1. Push this folder to a GitHub repository, select **Settings → Pages → Build and deployment → GitHub Actions**, and make sure the workflow is enabled.
2. Push to `main` or run **Deploy Primus to GitHub Pages** from the Actions tab. The deployment URL is shown in the workflow run.
3. Add the deployed sign-in, password-reset, and email-verification callback URLs to Supabase **Authentication → URL Configuration**.
4. Configure the `SITE_URL` Edge Function secret as the full GitHub Pages base URL, including the repository subpath (for example `https://OWNER.github.io/REPOSITORY/`). This preserves the checkout redirect path. Keep `FLW_SECRET_KEY` in Supabase Edge Function secrets, not in GitHub or browser files.

GitHub Pages can publish a preview backed by the confirmed test Supabase project. Before accepting real customers, replace the frontend Supabase URL/key with the production project and configure production provider credentials through Supabase secrets.

## Public reference data

The monthly reference-data updater writes Uganda mapped locations, Wikidata brands, limited Open Food Facts/Open Beauty Facts samples, and the current Primus category specification templates to JSON. See [`data/reference/README.md`](../data/reference/README.md) for run instructions, Windows Task Scheduler setup, source coverage, and attribution/licensing requirements. The imported datasets are not exhaustive.
