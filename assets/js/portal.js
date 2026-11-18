document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const route = body.dataset.route || '';
    const group = body.dataset.group || 'marketplace';
    const title = body.dataset.title || 'Primus';
    const groupLabel = body.dataset.groupLabel || 'Marketplace';
    const routes = window.PRIMUS_PAGE_ROUTES || [];
    const content = document.getElementById('portalContent');
    const toast = document.getElementById('portalToast');
    const products = [
        { id: 'linen-shirt', name: 'Linen Blend Shirt', seller: 'Mirembe Studio', category: 'Fashion', price: 145000, stock: 7, rating: 4.8, image: 'https://images.unsplash.com/photo-1598554747436-c9293d6a588f?auto=format&fit=crop&w=600&q=80' },
        { id: 'woven-tote', name: 'Woven Everyday Tote', seller: 'Kampala Craft Co.', category: 'Accessories', price: 89000, stock: 11, rating: 4.9, image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=600&q=80' },
        { id: 'ceramic-vase', name: 'Soft Form Ceramic Vase', seller: 'Clay & Form', category: 'Home', price: 72000, stock: 4, rating: 4.7, image: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=600&q=80' },
        { id: 'glow-oil', name: 'Everyday Glow Oil', seller: 'Nile Botanics', category: 'Beauty', price: 55000, stock: 18, rating: 4.8, image: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=600&q=80' },
        { id: 'studio-headphones', name: 'Studio Wireless Headphones', seller: 'Urban Tech UG', category: 'Electronics', price: 320000, stock: 6, rating: 4.6, image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80' },
        { id: 'smart-watch', name: 'Chronos Minimal Watch', seller: 'Urban Tech UG', category: 'Electronics', price: 240000, stock: 0, rating: 4.5, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80' },
        { id: 'coffee-beans', name: 'Rwenzori Arabica Coffee', seller: 'Good Grain', category: 'Groceries', price: 38000, stock: 24, rating: 4.9, image: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=600&q=80' },
        { id: 'home-repair', name: 'Home Refresh Consultation', seller: 'Kintu Home Care', category: 'Services', price: 65000, stock: 5, rating: 4.7, image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=600&q=80' }
    ];
    window.PRIMUS_PREVIEW_PRODUCTS = products;
    let toastTimer;

    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function formatPrice(value) {
        return `UGX ${new Intl.NumberFormat('en-UG').format(value)}`;
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('is-visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
    }

    function readCart() {
        try {
            const saved = JSON.parse(localStorage.getItem('primus-cart') || '[]');
            if (Array.isArray(saved)) return saved;
            throw new TypeError('Saved Primus cart data must be an array.');
        } catch (error) {
            console.error('Unable to read the saved Primus cart.', error);
            return [];
        }
    }

    function updateBagCount() {
        const count = readCart().reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        document.getElementById('portalBagCount').textContent = String(count);
    }

    function saveWishlist(wishlist) {
        localStorage.setItem('primus-wishlist', JSON.stringify(wishlist));
        const count = document.getElementById('siteWishlistCount');
        if (count) count.textContent = String(wishlist.length);
        window.dispatchEvent(new StorageEvent('storage', { key: 'primus-wishlist' }));
    }

    function renderNavigation() {
        const pageRoutes = routes.filter(item => item.group === group);
        const navigation = document.getElementById('portalNav');
        const links = [
            { path: 'index.html', title: 'Marketplace home', href: '../../index.html' },
            { path: 'pages/marketplace/index.html', title: 'Shop products', href: '../../pages/marketplace/index.html' },
            ...pageRoutes.map(item => ({
                path: item.path,
                title: item.title,
                href: `../../${item.path}`
            }))
        ];
        const unique = new Map(links.map(link => [link.href, link]));
        navigation.innerHTML = [...unique.values()].map(link => {
            const active = link.path === route;
            return `<a href="${escapeHTML(link.href)}"${active ? ' aria-current="page"' : ''}>${escapeHTML(link.title)}</a>`;
        }).join('');
    }

    function renderPageHeading() {
        document.title = `${title} | Primus`;
        document.getElementById('portalPageTitle').textContent = title;
        document.getElementById('portalPageHeading').textContent = title;
        document.getElementById('portalGroupLabel').textContent = groupLabel;
        document.getElementById('portalDescription').textContent = getDescription(route, title);
    }

    function getDescription(pageRoute, pageTitle) {
        if (group === 'buyer-dashboard') return 'Your account, orders, and saved finds in one place.';
        if (group === 'seller-dashboard') return 'Manage your shop, products, orders, and earnings.';
        if (group === 'rider-dashboard') return 'Manage delivery work, availability, and earnings.';
        if (group === 'admin') return 'Marketplace operations and oversight.';
        if (pageRoute.includes('/auth/')) return 'Secure account access for the Primus community.';
        if (pageRoute.includes('/checkout/') || pageRoute.includes('/cart/')) return 'Review your order and prepare for a smooth checkout.';
        if (pageRoute.includes('/messages/')) return 'Keep conversations with buyers, sellers, and delivery partners organized.';
        if (pageRoute.includes('/delivery/')) return 'Delivery information and order progress for your Primus purchases.';
        if (pageRoute.endsWith('/become-a-seller.html')) return 'Bring your shop to local customers and manage your listings in one place.';
        if (pageRoute.endsWith('/become-a-rider.html')) return 'Apply to deliver Primus orders after administrator approval.';
        if (pageRoute.includes('/services/')) return 'Discover trusted local professionals and useful services.';
        if (pageRoute.includes('/support/')) return 'Find answers and get help from the Primus support team.';
        if (pageRoute.includes('/legal/')) return 'Important information about shopping and selling on Primus.';
        if (pageRoute.includes('/ai-assistant/')) return 'Get a hand finding products and services that fit your needs.';
        if (/product|category|search|discover|deals|brands|mini-shops/.test(pageRoute)) return `Explore ${pageTitle.toLowerCase()} from independent local sellers.`;
        return `Explore ${pageTitle.toLowerCase()} on Primus Marketplace.`;
    }

    function renderDashboard() {
        const statsByGroup = {
            'buyer-dashboard': [['Open orders', '03', '1 arriving today'], ['Wishlist', '08', '2 new finds'], ['Messages', '02', '1 unread'], ['Rewards', '120', 'points available']],
            'seller-dashboard': [['Active products', '24', '3 low in stock'], ['Open orders', '08', '2 need attention'], ['This month', 'UGX 1.8M', '+12% this month'], ['Rating', '4.8', 'from 126 reviews']],
            'rider-dashboard': [['Available jobs', '06', 'nearby deliveries'], ['Completed', '42', 'this month'], ['Earnings', 'UGX 640K', 'ready to review'], ['Rating', '4.9', 'from 38 reviews']],
            admin: [['Active buyers', '1,284', '+8% this month'], ['Seller shops', '96', '4 awaiting review'], ['Open orders', '72', '12 need attention'], ['Support tickets', '09', '3 high priority']]
        };
        const stats = statsByGroup[group] || statsByGroup['buyer-dashboard'];
        const groupRoutes = routes.filter(item => item.group === group && item.path !== route).slice(0, 4);
        return `<div class="portal-stats">${stats.map(stat => `<article class="portal-stat"><span>${escapeHTML(stat[0])}</span><strong>${escapeHTML(stat[1])}</strong><small>${escapeHTML(stat[2])}</small></article>`).join('')}</div>
            <h3 class="portal-section-title">Quick access</h3>
            <div class="portal-cards">${groupRoutes.map(item => `<article class="portal-card"><h3>${escapeHTML(item.title)}</h3><p>Open ${escapeHTML(item.title.toLowerCase())} and review the latest activity.</p><a class="portal-card-link" href="../../${escapeHTML(item.path)}">Open page &rarr;</a></article>`).join('')}</div>
            <h3 class="portal-section-title">Recent activity</h3>${renderTable(['Activity', 'Reference', 'Status'], [['New order received', '#PR-1024', 'Processing'], ['Profile information updated', 'Today, 10:42', 'Complete'], ['New message from support', 'Yesterday', 'Unread']])}
            <p class="portal-callout">Dashboard figures are sample data in this preview. Connect your marketplace database to show live account information.</p>`;
    }

    function renderProductCatalog() {
        return `<form class="portal-search" id="portalProductSearch"><label class="sr-only" for="portalSearchInput">Search products</label><input id="portalSearchInput" type="search" placeholder="Search products and shops"><button type="submit">Search</button></form>
            <div class="portal-products" id="portalProducts">${products.map(renderProduct).join('')}</div>
            <p class="portal-empty" id="portalEmpty" hidden>No matches yet. Try another search.</p>
            <p class="portal-callout">Catalog items are sample listings for the frontend preview.</p>`;
    }

    function renderProductDetail() {
        const product = products.find(item => item.id === new URLSearchParams(window.location.search).get('product'));
        if (!product) return `<div class="portal-callout">This sample product could not be found. Browse the catalog to see available items.</div><a class="portal-action" href="../../pages/products/all-products.html">Browse products</a>`;
        return `<article class="portal-product-detail"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}"><div><small>${escapeHTML(product.category)} · ${escapeHTML(product.seller)}</small><h3>${escapeHTML(product.name)}</h3><p>${formatPrice(product.price)} <span>★ ${product.rating}</span></p><p class="portal-product-description">A thoughtful pick from a local Primus seller. Product details and availability are sample data for this preview.</p><button type="button" data-add-product="${escapeHTML(product.id)}" ${product.stock === 0 ? 'disabled' : ''}>${product.stock ? 'Add to bag' : 'Sold out'}</button><p class="portal-callout">Seller: ${escapeHTML(product.seller)} · Available sample stock: ${product.stock}</p></div></article>`;
    }

    function renderWishlist() {
        let saved;
        try {
            saved = JSON.parse(localStorage.getItem('primus-wishlist') || '[]');
            if (!Array.isArray(saved)) throw new TypeError('Saved Primus wishlist data must be an array.');
        } catch (error) {
            console.error('Unable to read the saved Primus wishlist.', error);
            return '<p class="portal-callout">The saved wishlist could not be loaded from this browser.</p>';
        }
        const savedProducts = products.filter(product => saved.includes(product.id));
        if (!savedProducts.length && !saved.length) return '<div class="portal-cart-empty"><h3>Your wishlist is ready for good finds.</h3><p>Save products from the marketplace to see them here.</p><a class="portal-action" href="../../pages/marketplace/index.html">Explore products</a></div>';
        const missingIds = saved.filter(id => !savedProducts.some(product => product.id === id));
        return `${missingIds.length ? '<p class="portal-callout">Some saved products could not be loaded. Remove unavailable items to clean up your wishlist. <button type="button" data-demo-wishlist-clear>Remove unavailable items</button></p>' : ''}
        ${savedProducts.length ? `<div class="portal-products">${savedProducts.map(product => `<article class="portal-product">
            <a href="../../pages/products/product-details.html?product=${encodeURIComponent(product.id)}"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy"></a>
            <div><small>${escapeHTML(product.category)} · ${escapeHTML(product.seller)}</small><h3><a href="../../pages/products/product-details.html?product=${encodeURIComponent(product.id)}">${escapeHTML(product.name)}</a></h3>
            <p>${formatPrice(product.price)} <span aria-label="rating">★ ${product.rating}</span></p>
            <button type="button" data-add-product="${escapeHTML(product.id)}" ${product.stock === 0 ? 'disabled' : ''}>${product.stock ? 'Add to bag' : 'Sold out'}</button>
            <button type="button" data-demo-wishlist-remove="${escapeHTML(product.id)}">Remove</button></div>
        </article>`).join('')}</div>` : '<div class="portal-cart-empty"><h3>No saved products are available</h3><p>Explore the marketplace for new finds.</p><a class="portal-action" href="../../pages/marketplace/index.html">Explore products</a></div>'}`;
    }

    function renderProduct(product) {
        return `<article class="portal-product" data-search="${escapeHTML(`${product.name} ${product.seller} ${product.category}`.toLowerCase())}">
            <a href="../../pages/products/product-details.html?product=${encodeURIComponent(product.id)}"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy"></a>
            <div><small>${escapeHTML(product.category)} · ${escapeHTML(product.seller)}</small><h3><a href="../../pages/products/product-details.html?product=${encodeURIComponent(product.id)}">${escapeHTML(product.name)}</a></h3><p>${formatPrice(product.price)} <span aria-label="rating">★ ${product.rating}</span></p><button type="button" data-add-product="${escapeHTML(product.id)}" ${product.stock === 0 ? 'disabled' : ''}>${product.stock ? 'Add to bag' : 'Sold out'}</button></div>
        </article>`;
    }

    function renderTable(headers, rows) {
        return `<div class="portal-table-wrap"><table class="portal-table"><thead><tr>${headers.map(header => `<th>${escapeHTML(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHTML(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }

    function renderFAQ() {
        return `<div class="portal-faq"><details open><summary>How do I place an order?</summary><p>Browse the marketplace, add items to your bag, and follow the checkout steps. Mobile Money and delivery options will be enabled when the payment and order services are connected.</p></details><details><summary>How can I become a seller?</summary><p>Start with the seller registration page, then complete your shop profile and product listings after your seller account is approved.</p></details><details><summary>How do deliveries work?</summary><p>Available delivery options and estimated arrival details are shown with each order. Live rider tracking requires the delivery service integration.</p></details><details><summary>How do I get help with an order?</summary><p>Use your order details page to contact the seller or create a support request.</p></details></div>`;
    }

    function renderRiderSignup() {
        return `<div class="portal-cards">
            <article class="portal-card"><h3>Deliver on your schedule</h3><p>Join Primus delivery and help local shoppers receive orders from nearby sellers.</p></article>
            <article class="portal-card"><h3>How to get started</h3><p>Create a rider account with your name, phone number, email, and password. Primus will review your request before enabling rider tools.</p></article>
            <article class="portal-card"><h3>Approval protects everyone</h3><p>Signing up does not grant rider permissions automatically. An administrator must review and approve your account before you can access delivery jobs or location sharing.</p></article>
        </div>
        <div class="portal-card"><h3>Ready to apply?</h3><p>Continue to the secure registration form. Supabase handles your password; Primus does not store it in marketplace tables.</p>
            <a class="portal-action" href="../../pages/auth/rider-register.html">Register as a rider &rarr;</a>
            <p class="form-note">Already have an account? <a href="../../pages/auth/login.html">Sign in</a> and contact Primus support to request rider review.</p>
        </div>`;
    }

    function renderSellerSignup() {
        return `<div class="portal-cards">
            <article class="portal-card"><h3>Reach local shoppers</h3><p>Showcase your products to customers looking for businesses and makers across Uganda.</p></article>
            <article class="portal-card"><h3>Manage your shop</h3><p>Once approved, add product listings with photos, prices, stock, and category-specific details.</p></article>
            <article class="portal-card"><h3>Keep orders organized</h3><p>Use your seller dashboard to review incoming orders, update fulfilment, and stay in touch with customers.</p></article>
            <article class="portal-card"><h3>How seller access works</h3><p>Create an account with your shop details and accept the seller terms. An administrator must approve seller access before you can publish listings or use seller tools.</p></article>
            <article class="portal-card"><h3>Commission and returns</h3><p>Primus charges 5% of the original item value. Change-of-mind returns requested within 3 days receive 75% of item value; wrong or faulty items qualify for a full item refund or replacement.</p><a class="portal-card-link" href="../../pages/legal/seller-policy.html">Read seller policy &rarr;</a></article>
        </div>
        <div class="portal-card">
            <h3>Ready to set up your shop?</h3>
            <p>Register with your shop contact and physical location. Your shop address and phone are public on your storefront. Registration does not automatically grant seller permissions.</p>
            <a class="portal-action" href="../../pages/auth/seller-register.html">Create a seller account &rarr;</a>
            <p class="form-note">Already registered? <a href="../../pages/auth/login.html">Sign in</a>. Need help with seller approval? <a href="../../pages/support/index.html">Contact support</a>.</p>
        </div>`;
    }

    function formField(label, type, placeholder, fullWidth) {
        const safeLabel = escapeHTML(label);
        const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        if (type === 'textarea') return `<label class="form-field${fullWidth ? ' full-width' : ''}" for="${id}">${safeLabel}<textarea id="${id}" name="${id}" placeholder="${escapeHTML(placeholder || '')}" required></textarea></label>`;
        return `<label class="form-field${fullWidth ? ' full-width' : ''}" for="${id}">${safeLabel}<input id="${id}" name="${id}" type="${escapeHTML(type)}" placeholder="${escapeHTML(placeholder || '')}" ${type === 'file' ? '' : 'required'}></label>`;
    }

    function renderSellerRegistrationForm() {
        return `<form class="portal-form portal-seller-registration" id="portalDemoForm">
            <label class="form-field">Your full name<input name="display_name" type="text" maxlength="120" autocomplete="name" required></label>
            <label class="form-field">Shop name<input name="shop_name" type="text" maxlength="160" autocomplete="organization" required></label>
            <label class="form-field">Email address<input name="email" type="email" autocomplete="email" required></label>
            <label class="form-field">Public shop phone<input name="phone_number" type="tel" maxlength="40" autocomplete="tel" required></label>
            <label class="form-field">District<input name="shop_district" type="text" maxlength="100" autocomplete="address-level1" required></label>
            <label class="form-field">City or town<input name="shop_city" type="text" maxlength="100" autocomplete="address-level2" required></label>
            <label class="form-field">Area or neighbourhood<input name="shop_area" type="text" maxlength="120" required></label>
            <label class="form-field full-width">Physical shop address <span class="field-help">This address will be public on your storefront and used for approved returns.</span><input name="shop_address" type="text" maxlength="300" autocomplete="street-address" required></label>
            <label class="form-field full-width">About your shop<textarea name="shop_description" maxlength="1000" rows="4" placeholder="Tell customers what you sell and what makes your shop special."></textarea></label>
            <label class="form-field">Password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
            <label class="form-field">Confirm password<input name="password_confirmation" type="password" minlength="8" autocomplete="new-password" required></label>
            <input type="hidden" name="seller_terms_version" value="seller-v2-2026-11-19">
            <details class="portal-seller-terms full-width">
                <summary>Read the seller terms</summary>
                <ol>
                    <li><strong>Accurate shop details.</strong> Keep your shop name, public phone number, location, and product information accurate and up to date. Your contact phone and full shop address appear on your public storefront.</li>
                    <li><strong>Product listings and fulfilment.</strong> Use genuine photos and descriptions, keep prices and stock current, and fulfil accepted orders as agreed. Do not list prohibited, counterfeit, or unsafe goods.</li>
                    <li><strong>Primus commission.</strong> Primus charges a 5% commission on the original value of each product line sold. For eligible paid Flutterwave Mobile Money orders, the commission is deducted from the seller's settlement. Cash-on-delivery commission collection remains manual. The fee is not reversed when an order is returned or refunded.</li>
                    <li><strong>Change-of-mind returns.</strong> A buyer may request a return within 3 days after delivery and bring the item back to your shop. Once the returned item is received, the buyer gets 75% of the item value; delivery charges are excluded.</li>
                    <li><strong>Wrong or faulty items.</strong> For an item that is wrong or faulty, offer the buyer a replacement or a full refund of the item value after the item is returned to the shop. Delivery charges are handled separately.</li>
                    <li><strong>Return handling.</strong> Respond to return requests promptly, confirm when an item is received, and keep the item safe while the refund or replacement is completed. For eligible paid Mobile Money orders, Primus initiates a Flutterwave refund after confirming receipt; cash-on-delivery refunds are paid and recorded manually.</li>
                    <li><strong>Customer care and compliance.</strong> Treat customers fairly, protect their information, and follow applicable Ugandan laws. Primus may restrict listings or accounts for repeated policy violations.</li>
                </ol>
                <p class="form-note">These are marketplace rules, not legal advice. Review them before accepting.</p>
            </details>
            <label class="portal-terms-consent full-width"><input name="seller_terms" type="checkbox" required><span>I have read and agree to the seller terms, including the 5% commission and return/refund policy.</span></label>
            <p class="form-note full-width" id="authPasswordNote">Seller tools are enabled only after administrator approval. Supabase handles your password; it is never stored in Primus profile data.</p>
            <button type="submit">Create seller account</button>
            <p class="portal-form-message full-width" id="portalFormMessage" role="status" aria-live="polite"></p>
        </form>`;
    }

    function renderForm() {
        const lowered = route.toLowerCase();
        if (lowered.endsWith('/seller-register.html')) return renderSellerRegistrationForm();
        let fields = [];
        if (lowered.includes('login')) fields = [['Email address', 'email'], ['Password', 'password']];
        else if (lowered.includes('seller-register')) fields = [['Your name', 'text'], ['Shop name', 'text'], ['Email address', 'email'], ['Phone number', 'tel'], ['Password', 'password']];
        else if (lowered.includes('rider-register')) fields = [['Your name', 'text'], ['Phone number', 'tel'], ['Email address', 'email'], ['Password', 'password']];
        else if (lowered.endsWith('register.html')) fields = [['Full name', 'text'], ['Email address', 'email'], ['Phone number', 'tel'], ['Password', 'password']];
        else if (lowered.includes('forgot-password') || lowered.includes('verify-email')) fields = [['Email address', 'email']];
        else if (lowered.includes('verify-phone')) fields = [['Phone number', 'tel'], ['Verification code', 'text']];
        else if (lowered.includes('verification')) fields = [['Document type', 'text'], ['Upload document', 'file']];
        else if (lowered.includes('reset-password')) fields = [['New password', 'password'], ['Confirm password', 'password']];
        else if (lowered.includes('checkout/address')) fields = [['Full name', 'text'], ['Phone number', 'tel'], ['Address', 'text'], ['City / area', 'text']];
        else if (lowered.includes('checkout/payment')) fields = [['Payment method', 'text'], ['Mobile Money number', 'tel']];
        else if (/contact|ticket|booking|create|edit|add-product|promotion/.test(lowered)) fields = [['Name', 'text'], ['Email address', 'email'], ['Subject', 'text'], ['Details', 'textarea']];
        else if (/profile|settings|address|currency|availability/.test(lowered)) fields = [['Display name', 'text'], ['Email address', 'email'], ['Phone number', 'tel']];
        else fields = [['Name', 'text'], ['Email address', 'email'], ['Details', 'textarea']];
        const button = lowered.includes('login') ? 'Sign in' : lowered.includes('register') ? 'Create account' : lowered.includes('checkout') ? 'Continue' : 'Save changes';
        return `<form class="portal-form" id="portalDemoForm">${fields.map((field, index) => formField(field[0], field[1], field[1] === 'textarea' ? 'Share any useful details' : '', field[1] === 'textarea' || (fields.length % 2 === 1 && index === fields.length - 1))).join('')}<p class="form-note">This is a frontend preview. Form submissions are not sent to a server and passwords are never saved here.</p><button type="submit">${button}</button><p class="portal-form-message" id="portalFormMessage" aria-live="polite"></p></form>`;
    }

    function renderMessages() {
        if (route.endsWith('/conversation.html')) {
            return `<div class="portal-message-list"><article class="portal-message"><div><strong>Customer</strong><p>Hello, can you confirm the delivery estimate for my order?</p></div><time>10:14</time></article><article class="portal-message"><div><strong>You</strong><p>Thanks for reaching out. I am checking that for you now.</p></div><time>10:18</time></article></div><form class="portal-form portal-message-compose" id="portalDemoForm">${formField('Message', 'textarea', 'Write a reply', true)}<p class="form-note">Messages are not sent in this frontend preview.</p><button type="submit">Send message</button><p class="portal-form-message" id="portalFormMessage" aria-live="polite"></p></form>`;
        }
        return `<div class="portal-message-list">${[['Mirembe Studio', 'Your order has been packed and is ready to go.', '10:18'], ['Delivery Support', 'Your rider is on the way.', '09:42'], ['Primus Support', 'We have an update on your request.', 'Yesterday']].map(message => `<a class="portal-message" href="../../pages/messages/conversation.html"><div><strong>${escapeHTML(message[0])}</strong><p>${escapeHTML(message[1])}</p></div><time>${escapeHTML(message[2])}</time></a>`).join('')}</div><p class="portal-callout">Messages shown here are example conversations. Real-time messaging and attachments need the messaging service connection.</p>`;
    }

    function renderCart() {
        const cart = readCart();
        const entries = cart.map(item => {
            const product = products.find(candidate => candidate.id === item.id);
            if (!Number(item.quantity)) return '';
            if (!product) return `<article class="portal-cart-item" data-product-id="${escapeHTML(item.id)}"><div><h3>Unavailable product</h3><p>This item is no longer available.</p><button type="button" data-cart-action="remove">Remove</button></div></article>`;
            return `<article class="portal-cart-item" data-product-id="${escapeHTML(product.id)}"><img src="${escapeHTML(product.image)}" alt=""><div><h3>${escapeHTML(product.name)}</h3><p>${formatPrice(product.price)}</p><div class="portal-cart-controls"><button type="button" data-cart-action="decrease" aria-label="Decrease ${escapeHTML(product.name)} quantity">−</button><span>${Number(item.quantity)}</span><button type="button" data-cart-action="increase" aria-label="Increase ${escapeHTML(product.name)} quantity">+</button><button type="button" data-cart-action="remove">Remove</button></div></div></article>`;
        }).filter(Boolean).join('');
        const hasUnavailableItems = cart.some(item => !products.some(product => product.id === item.id));
        const subtotal = cart.reduce((sum, item) => {
            const product = products.find(candidate => candidate.id === item.id);
            return sum + (product ? product.price * (Number(item.quantity) || 0) : 0);
        }, 0);
        if (!entries) return `<div class="portal-cart-empty"><h3>Your bag is taking a little breather.</h3><p>Explore local finds and add something you love.</p><a class="portal-action" href="../../pages/marketplace/index.html">Keep exploring</a></div>`;
        const action = hasUnavailableItems
            ? '<button type="button" disabled>Remove unavailable products to check out</button>'
            : route.endsWith('/checkout/index.html')
            ? '<a class="portal-action" href="../../pages/checkout/address.html">Continue to delivery address</a>'
            : '<a class="portal-action" href="../../pages/checkout/index.html">Continue to checkout</a>';
        return `<div class="portal-cart">${entries}</div><div class="portal-cart-summary"><span>Subtotal</span><strong>${formatPrice(subtotal)}</strong><p>Delivery is calculated at checkout.</p>${action}</div><p class="portal-callout">This is a local preview cart. Checkout and payment are not connected to a service.</p>`;
    }

    function renderCheckout() {
        if (route.endsWith('/checkout/index.html')) {
            const cart = readCart();
            if (!cart.length) return `<div class="portal-cart-empty"><h3>Your bag is empty.</h3><p>Add a product before starting checkout.</p><a class="portal-action" href="../../pages/products/all-products.html">Browse products</a></div>`;
            return `<div class="portal-callout">Checkout is a preview only. No payment or order will be created.</div><div class="portal-checkout-steps"><a href="../../pages/checkout/address.html">1. Delivery address</a><a href="../../pages/checkout/delivery.html">2. Delivery method</a><a href="../../pages/checkout/payment.html">3. Payment method</a></div>${renderCart()}`;
        }
        if (route.endsWith('/checkout/processing.html')) return `<div class="portal-callout">Payment processing is not connected. No payment has been started or charged.</div><a class="portal-action" href="../../pages/cart/index.html">Return to bag</a>`;
        if (route.endsWith('/checkout/success.html') || route.endsWith('/orders/confirmation.html')) return `<div class="portal-callout">This confirmation page is a preview. No order has been placed.</div><a class="portal-action" href="../../pages/marketplace/index.html">Continue shopping</a>`;
        if (route.endsWith('/checkout/failed.html')) return `<div class="portal-callout">Payment status preview. No payment attempt was made.</div><a class="portal-action" href="../../pages/checkout/payment.html">Review payment options</a>`;
        if (route.endsWith('/checkout/address.html')) return renderForm();
        if (route.endsWith('/checkout/delivery.html')) return `<form class="portal-form" id="portalDemoForm"><label class="form-field full-width">Delivery option<select required><option value="">Choose a delivery option</option><option>Standard delivery · sample</option><option>Pickup · sample</option></select></label><p class="form-note">Delivery availability and pricing are not connected.</p><button type="submit">Save delivery option</button><p class="portal-form-message" id="portalFormMessage" aria-live="polite"></p></form>`;
        if (route.endsWith('/checkout/payment.html')) return renderForm();
        return `<div class="portal-callout">Saved checkout details are not connected in this preview.</div><a class="portal-action" href="../../pages/checkout/index.html">Return to checkout</a>`;
    }

    function renderTracking() {
        const riderControls = group === 'rider-dashboard' && /navigation|active-delivery/.test(route);
        const locationCard = riderControls
            ? `<section class="portal-gps-card" aria-labelledby="gpsTitle"><div><p class="portal-eyebrow">Rider location</p><h3 id="gpsTitle">Share your current position</h3><p>Your browser will ask before reading location. This is a one-time reading: Primus does not store it, send it, or track you in the background.</p><button id="requestGps" type="button">Use my current location</button><p id="gpsStatus" role="status" aria-live="polite">Location has not been requested.</p><a id="gpsMapLink" href="#" target="_blank" rel="noopener noreferrer" hidden>Open this location in OpenStreetMap</a></div></section>`
            : `<p class="portal-callout">Live rider location is only available after the assigned rider explicitly shares it through a connected, consent-based delivery service. No live location is collected on this preview.</p>`;
        return `${locationCard}<div class="portal-timeline"><span class="is-done">Order placed</span><span class="is-done">Preparing</span><span>On the way</span><span>Delivered</span></div><h3 class="portal-section-title">Delivery updates</h3>${renderTable(['Update', 'Time', 'Status'], [['Order confirmed', '09:15', 'Complete'], ['Rider assigned', '09:42', 'Complete'], ['Arrival estimate', 'Pending', 'In progress']])}<p class="portal-callout">Status and times are sample data for layout preview.</p>`;
    }

    function renderContent() {
        const lowered = route.toLowerCase();
        if (lowered === 'pages/landing/become-a-seller.html') return renderSellerSignup();
        if (lowered === 'pages/landing/become-a-rider.html') return renderRiderSignup();
        if (/\/(buyer-dashboard|seller-dashboard|rider-dashboard|admin)\/index\.html$/.test(`/${route}`)) return renderDashboard();
        if (lowered.endsWith('/products/product-details.html')) return renderProductDetail();
        if (/product|category|search|discover|deals|brands|mini-shops/.test(lowered) && !/product-details|product-approvals|edit-product|add-product|compare|reviews|questions/.test(lowered)) return renderProductCatalog();
        if (lowered.includes('/auth/')) {
            if (lowered.includes('access-denied')) return `<div class="portal-callout">This area requires a verified Primus account with the appropriate permissions.</div><a class="portal-action" href="../../pages/auth/login.html">Return to sign in</a>`;
            return renderForm();
        }
        if (lowered.startsWith('pages/cart/')) return renderCart();
        if (lowered.startsWith('pages/checkout/') || lowered.endsWith('/orders/confirmation.html')) return renderCheckout();
        if (lowered.includes('messages')) return renderMessages();
        if (lowered.includes('wishlist')) return renderWishlist();
        if (lowered.includes('faq')) return renderFAQ();
        if (/contact|ticket|booking|create|edit|add-product|promotion|profile|settings|address|currency|availability/.test(lowered)) return renderForm();
        if (/tracking|navigation|active-delivery|live-tracking/.test(lowered)) return renderTracking();
        if (lowered.endsWith('/legal/seller-policy.html')) return `<section class="portal-return-policy"><h3>Seller terms and commission</h3><ul><li>Keep shop contact, public location, prices, stock, and product descriptions accurate. Shop contact phone and full shop address are public to customers.</li><li>Primus commission is 5% of each sold product line's original item value (unit price × quantity). The commission is not reversed when an item is returned or refunded. It is deducted from eligible Flutterwave Mobile Money settlements; cash-on-delivery commission collection remains manual.</li><li>Change-of-mind returns must be requested within 3 days after delivery and brought to the shop. The buyer receives 75% of item value; delivery charges are excluded.</li><li>For wrong or faulty goods, after return to the shop, provide a replacement or refund the full item value. Delivery charges are handled separately.</li><li>Refunds for paid Mobile Money orders are initiated through Flutterwave after the return is confirmed. Cash-on-delivery refunds are manually paid and recorded. A provider refund is complete only after Flutterwave confirms successful payout.</li><li>Seller access and publishing tools are enabled only after administrator approval.</li></ul><p>These marketplace rules are a product policy summary, not legal advice.</p></section>`;
        if (lowered.endsWith('/legal/refund-policy.html')) return `<section class="portal-return-policy"><h3>Returns and refunds</h3><ul><li>Start a return request within 3 days after the order is marked delivered. Requests outside this period are rejected.</li><li>For a change of mind, bring the approved item to the seller's public shop address. After the seller confirms receipt, the refund is 75% of item value; delivery fees are not included.</li><li>For a wrong or faulty item, return it to the shop. The seller must choose a full item-value refund or replacement.</li><li>For paid Mobile Money orders, an administrator initiates a Flutterwave refund and the request is complete only after provider confirmation. Cash-on-delivery refunds are manually issued and recorded.</li><li>Primus's 5% commission is calculated from the original item value and is not reversed by a return or refund.</li></ul><p><a href="../../pages/buyer-dashboard/refunds.html">Open return requests &rarr;</a></p></section>`;
        if (/terms|privacy|cookies|policy|guidelines/.test(lowered)) return `<p class="portal-callout">This page is a starter for Primus policies. Replace this sample copy with the reviewed and approved policy text before launch.</p><div class="portal-cards"><article class="portal-card"><h3>Using Primus</h3><p>Use the marketplace respectfully and provide accurate account and order information.</p></article><article class="portal-card"><h3>Your information</h3><p>Primus should explain what information it collects, how it is used, and how customers can contact support.</p></article></div>`;
        if (/orders|transactions|payments|settlements|refund|returns|earnings|deliveries|jobs|customers|users|sellers|riders|inventory|stock|analytics|reports|audit|approvals|commissions|disputes|reviews/.test(lowered)) return `${renderTable(['Reference', 'Date', 'Details', 'Status'], [['PR-1024', 'Today', `${title} record`, 'Processing'], ['PR-1019', 'Yesterday', 'Updated by a local account', 'Complete'], ['PR-1012', '18 Nov 2026', 'Awaiting review', 'Pending']])}<p class="portal-callout">Sample records for layout preview. Live data and administrative actions require the Primus backend.</p>`;
        if (/about|how-it-works|help|support|benefit|delivery\/index/.test(lowered)) return `<div class="portal-cards"><article class="portal-card"><h3>Discover</h3><p>Explore products and services from independent businesses across Uganda.</p></article><article class="portal-card"><h3>Shop confidently</h3><p>Review seller details, product information, and delivery options before placing an order.</p></article><article class="portal-card"><h3>Support local</h3><p>Every purchase helps local sellers and service providers reach new customers.</p></article><article class="portal-card"><h3>Need a hand?</h3><p>Visit the Help Centre to find answers or contact the support team.</p><a class="portal-card-link" href="../../pages/support/index.html">Visit Help Centre &rarr;</a></article></div>`;
        return `<div class="portal-cards"><article class="portal-card"><h3>Explore ${escapeHTML(title)}</h3><p>Find relevant products, account information, and marketplace tools in this section.</p><a class="portal-card-link" href="../../pages/marketplace/index.html">Browse marketplace &rarr;</a></article><article class="portal-card"><h3>Need help?</h3><p>Get support with your account, orders, shop, or delivery.</p><a class="portal-card-link" href="../../pages/support/index.html">Open Help Centre &rarr;</a></article></div><p class="portal-callout">This page is part of the Primus route preview. Connect the relevant service to enable live records and actions.</p>`;
    }

    function handleFormSubmit(event) {
        event.preventDefault();
        const message = document.getElementById('portalFormMessage');
        if (message) message.textContent = 'Your form looks good. Submitting data will be enabled when Primus is connected to its services.';
        showToast('Preview only — no data was sent.');
    }

    function addProductToCart(productId) {
        const product = products.find(item => item.id === productId);
        if (!product) return;
        try {
            const saved = JSON.parse(localStorage.getItem('primus-cart') || '[]');
            const cart = Array.isArray(saved) ? saved : [];
            const existing = cart.find(item => item.id === productId);
            if (existing) {
                if (existing.quantity >= product.stock) {
                    showToast('All available sample stock is already in your bag.');
                    return;
                }
                existing.quantity += 1;
            } else {
                cart.push({ id: productId, quantity: 1 });
            }
            localStorage.setItem('primus-cart', JSON.stringify(cart));
            localStorage.setItem('primus-cart-count', String(cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)));
            updateBagCount();
            showToast(`${product.name} added to your bag.`);
        } catch (error) {
            console.error('Unable to update the saved Primus cart.', error);
            showToast('Your browser could not save this cart change.');
        }
    }

    renderPageHeading();
    renderNavigation();
    if (route !== 'pages/products/product-details.html') content.innerHTML = renderContent();
    updateBagCount();

    content.addEventListener('submit', event => {
        if (event.target.id === 'portalDemoForm') handleFormSubmit(event);
        if (event.target.id === 'portalProductSearch') {
            event.preventDefault();
            const query = document.getElementById('portalSearchInput').value.trim().toLowerCase();
            const cards = [...document.querySelectorAll('.portal-product')];
            let visible = 0;
            cards.forEach(card => {
                const matches = card.dataset.search.includes(query);
                card.hidden = !matches;
                if (matches) visible += 1;
            });
            document.getElementById('portalEmpty').hidden = visible > 0;
        }
    });

    content.addEventListener('click', event => {
        const button = event.target.closest('[data-add-product]');
        if (button) addProductToCart(button.dataset.addProduct);
        const removeWishlistButton = event.target.closest('[data-demo-wishlist-remove]');
        const clearUnavailableWishlistButton = event.target.closest('[data-demo-wishlist-clear]');
        if (removeWishlistButton || clearUnavailableWishlistButton) {
            try {
                const wishlist = JSON.parse(localStorage.getItem('primus-wishlist') || '[]');
                if (!Array.isArray(wishlist)) throw new TypeError('Saved Primus wishlist data must be an array.');
                const availableIds = new Set(products.map(product => product.id));
                saveWishlist(clearUnavailableWishlistButton
                    ? wishlist.filter(id => availableIds.has(id))
                    : wishlist.filter(id => id !== removeWishlistButton.dataset.demoWishlistRemove));
                content.innerHTML = renderContent();
            } catch (error) {
                console.error('Unable to update the saved Primus wishlist.', error);
                showToast('Your browser could not save this wishlist change.');
            }
            return;
        }
        if (event.target.closest('#requestGps')) {
            const status = document.getElementById('gpsStatus');
            const mapLink = document.getElementById('gpsMapLink');
            mapLink.hidden = true;
            if (!navigator.geolocation) {
                status.textContent = 'This browser does not support location access.';
                return;
            }
            status.textContent = 'Requesting location permission…';
            navigator.geolocation.getCurrentPosition(position => {
                const latitude = position.coords.latitude.toFixed(5);
                const longitude = position.coords.longitude.toFixed(5);
                status.textContent = `Current position: ${latitude}, ${longitude}. It has not been sent or saved.`;
                mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
                mapLink.hidden = false;
            }, error => {
                const messages = {
                    1: 'Location permission was denied. You can enable it in your browser settings.',
                    2: 'Your location is unavailable right now. Try again when a location signal is available.',
                    3: 'The location request timed out. Please try again.'
                };
                status.textContent = messages[error.code] || 'Unable to get your location.';
            }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        }
        const cartButton = event.target.closest('[data-cart-action]');
        if (cartButton) {
            const cart = readCart();
            const row = cartButton.closest('[data-product-id]');
            const item = row && cart.find(entry => entry.id === row.dataset.productId);
            if (!item) return;
            const product = products.find(candidate => candidate.id === item.id);
            if (cartButton.dataset.cartAction === 'increase' && product && Number(item.quantity) >= product.stock) {
                showToast('All available sample stock is already in your bag.');
                return;
            }
            try {
                const nextCart = cartButton.dataset.cartAction === 'remove'
                    || (cartButton.dataset.cartAction === 'decrease' && Number(item.quantity) <= 1)
                    ? cart.filter(entry => entry.id !== item.id)
                    : cart.map(entry => entry.id === item.id ? {
                        ...entry,
                        quantity: cartButton.dataset.cartAction === 'increase' ? Number(entry.quantity) + 1 : Number(entry.quantity) - 1
                    } : entry);
                localStorage.setItem('primus-cart', JSON.stringify(nextCart));
                const updatedCart = nextCart;
                localStorage.setItem('primus-cart-count', String(updatedCart.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0)));
                updateBagCount();
                content.innerHTML = renderContent();
            } catch (error) {
                console.error('Unable to update the saved Primus cart.', error);
                showToast('Your browser could not save this cart change.');
            }
        }
    });

    window.addEventListener('storage', event => {
        if (event.key === 'primus-cart' || event.key === 'primus-cart-count') updateBagCount();
        if (event.key === 'primus-wishlist' && route.includes('wishlist')) content.innerHTML = renderContent();
    });
});
