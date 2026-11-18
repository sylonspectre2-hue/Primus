const route = document.body.dataset.route || '';
const content = document.getElementById('portalContent');
const routeDepth = route ? route.split('/').length - 1 : 0;
const rootPath = '../'.repeat(routeDepth);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const productImageLimit = 10;
const productImageMaxBytes = 5 * 1024 * 1024;
const productImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const productCategorySpecs = {
    Fashion: [
        ['brand', 'Brand'], ['size', 'Size'], ['size_system', 'Size system'], ['color', 'Color'],
        ['material', 'Material'], ['fit', 'Fit'], ['gender', 'Designed for'], ['pattern', 'Pattern'],
        ['care_instructions', 'Care instructions'], ['country_of_origin', 'Country of origin']
    ],
    Electronics: [
        ['brand', 'Brand'], ['model', 'Model'], ['model_number', 'Model number'], ['condition', 'Condition'],
        ['color', 'Color'], ['screen_size', 'Screen size'], ['storage', 'Storage capacity'], ['memory', 'RAM / memory'],
        ['processor', 'Processor'], ['battery', 'Battery'], ['connectivity', 'Connectivity'],
        ['compatibility', 'Compatibility'], ['power_source', 'Power source'], ['warranty', 'Warranty'],
        ['included_items', 'Included in the box']
    ],
    Home: [
        ['brand', 'Brand / maker'], ['material', 'Material'], ['dimensions', 'Dimensions'], ['weight', 'Weight'],
        ['color', 'Color'], ['room', 'Recommended room / use'], ['care_instructions', 'Care instructions'],
        ['assembly', 'Assembly required'], ['included_items', 'Included items'], ['warranty', 'Warranty']
    ],
    Beauty: [
        ['brand', 'Brand'], ['product_type', 'Product type'], ['skin_hair_type', 'Skin / hair type'],
        ['ingredients', 'Ingredients'], ['volume', 'Net volume / weight'], ['usage', 'How to use'],
        ['expiry_date', 'Expiry date', 'date'], ['country_of_origin', 'Country of origin'], ['safety_notes', 'Safety notes']
    ],
    Groceries: [
        ['brand_or_producer', 'Brand / producer'], ['origin', 'Origin'], ['ingredients', 'Ingredients'],
        ['weight_volume', 'Net weight / volume'], ['expiry_date', 'Expiry date', 'date'],
        ['storage', 'Storage instructions'], ['dietary_info', 'Dietary information'], ['allergens', 'Allergens'],
        ['packaging', 'Packaging']
    ],
    Services: [
        ['service_type', 'Service type'], ['delivery_mode', 'On-site, remote, or pickup'],
        ['service_area', 'Service area'], ['duration', 'Typical duration'], ['booking_notice', 'Booking notice'],
        ['included', 'What is included'], ['requirements', 'Customer requirements'], ['cancellation_policy', 'Cancellation policy']
    ],
    Accessories: [
        ['brand', 'Brand / maker'], ['material', 'Material'], ['dimensions', 'Dimensions'],
        ['color', 'Color'], ['compatibility', 'Compatibility'], ['finish', 'Finish'],
        ['care_instructions', 'Care instructions'], ['included_items', 'Included items'], ['warranty', 'Warranty']
    ]
};
const supabase = await window.PRIMUS_SUPABASE_READY;
let currentUser = null;
let currentRole = null;
let notificationChannel = null;
let productCatalogMigrationRequired = false;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function money(value) {
    return `UGX ${new Intl.NumberFormat('en-UG').format(Number(value) || 0)}`;
}

function productImages(product) {
    const images = Array.isArray(product.image_urls) ? product.image_urls : [];
    return [...new Set([product.image_url, ...images].filter(url => typeof url === 'string' && /^https:\/\//i.test(url)))].slice(0, productImageLimit);
}

function renderProductSpecifications(specifications, category) {
    if (!specifications || typeof specifications !== 'object' || Array.isArray(specifications)) return '';
    const labels = new Map((productCategorySpecs[category] || []).map(([key, label]) => [key, label]));
    const values = Object.entries(specifications)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([key, value]) => [labels.get(key) || key.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()), value.trim()]);
    if (!values.length) return '';
    return `<section class="portal-product-specs"><h3>Product details</h3><dl>${values.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl></section>`;
}

function needsProductCatalogMigration(error) {
    return error?.code === '42703'
        && /\b(image_urls|specifications)\b/i.test(error.message || '');
}

function time(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' });
}

function notice(message, isError = false) {
    if (!content) return;
    const node = element('p', `portal-callout${isError ? ' is-error' : ''}`, message);
    content.replaceChildren(node);
}

function statusMessage(target, message, isError = false) {
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('is-error', isError);
}

function isCommerceRoute() {
    return route.startsWith('pages/seller-dashboard/')
        || route === 'pages/admin/products.html'
        || route === 'pages/admin/seller-applications.html'
        || route === 'pages/admin/rider-applications.html'
        || route === 'pages/admin/deliveries.html'
        || route === 'pages/admin/settlements.html'
        || route.startsWith('pages/buyer-dashboard/')
        || route.startsWith('pages/checkout/')
        || route.startsWith('pages/cart/')
        || route.startsWith('pages/search/')
        || route === 'pages/products/all-products.html'
        || route === 'pages/products/product-details.html'
        || route === 'pages/mini-shops/shop-page.html'
        || route === 'pages/seller-dashboard/shop-profile.html'
        || route === 'pages/admin/refunds.html'
        || route === 'pages/notifications/index.html';
}

function readCart() {
    try {
        const cart = JSON.parse(localStorage.getItem('primus-cart') || '[]');
        if (!Array.isArray(cart)) throw new TypeError('Saved cart data is not a list.');
        return cart
            .filter(item => item && typeof item.id === 'string' && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)
            .map(item => ({ ...item, quantity: Number(item.quantity) }));
    } catch (error) {
        console.error('Unable to read the saved cart.', error);
        throw new Error('Your saved bag could not be read. Clear the bag and try again.');
    }
}

function saveCart(cart) {
    localStorage.setItem('primus-cart', JSON.stringify(cart));
    localStorage.setItem('primus-cart-count', String(cart.reduce((sum, item) => sum + item.quantity, 0)));
    window.dispatchEvent(new StorageEvent('storage', { key: 'primus-cart' }));
}

function readWishlist() {
    try {
        const wishlist = JSON.parse(localStorage.getItem('primus-wishlist') || '[]');
        if (!Array.isArray(wishlist) || wishlist.some(id => typeof id !== 'string')) {
            throw new TypeError('Saved wishlist data is not a list of product IDs.');
        }
        return [...new Set(wishlist)];
    } catch (error) {
        console.error('Unable to read the saved wishlist.', error);
        throw new Error('Your saved wishlist could not be read. Clear the wishlist and try again.');
    }
}

function saveWishlist(wishlist) {
    localStorage.setItem('primus-wishlist', JSON.stringify(wishlist));
    const count = String(wishlist.length);
    for (const id of ['siteWishlistCount', 'wishlistCount']) {
        const counter = document.getElementById(id);
        if (counter) counter.textContent = count;
    }
    window.dispatchEvent(new StorageEvent('storage', { key: 'primus-wishlist' }));
}

function productPath(product) {
    return `${rootPath}pages/products/product-details.html?product=${encodeURIComponent(product.id)}`;
}

function renderProductCards(products) {
    if (!products.length) return '<div class="portal-cart-empty"><h3>No products found</h3><p>Try a different search or check back as sellers add new finds.</p></div>';
    return `<div class="portal-products">${products.map(product => `<article class="portal-product">
        <a href="${productPath(product)}"><img src="${escapeHTML(product.image_url)}" alt="${escapeHTML(product.name)}" loading="lazy"></a>
        <div><small>${escapeHTML(product.category)} · <a href="${rootPath}pages/mini-shops/shop-page.html?seller=${encodeURIComponent(product.seller_id)}">${escapeHTML(product.seller_name)}</a></small>
        <h3><a href="${productPath(product)}">${escapeHTML(product.name)}</a></h3>
        <p>${money(product.price_ugx)} <span>${Number(product.stock) > 0 ? `${Number(product.stock)} in stock` : 'Out of stock'}</span></p>
        <button type="button" data-commerce-add="${escapeHTML(product.id)}" ${Number(product.stock) <= 0 ? 'disabled' : ''}>${Number(product.stock) > 0 ? 'Add to bag' : 'Sold out'}</button></div>
    </article>`).join('')}</div>`;
}

function toMarketplaceProduct(product) {
    return {
        id: product.id,
        name: product.name,
        category: product.category,
        seller: product.seller_name,
        price: Number(product.price_ugx),
        rating: 0,
        reviews: 0,
        stock: Number(product.stock),
        delivery: 'standard',
        condition: 'new',
        verified: false,
        offer: false,
        badge: 'Local seller',
        image: product.image_url,
        images: productImages(product),
        specifications: product.specifications || {},
        specificationLabels: Object.fromEntries((productCategorySpecs[product.category] || []).map(([key, label]) => [key, label])),
        description: product.description
    };
}

async function initializeProductDetails() {
    if (route !== 'pages/products/product-details.html') return;
    const productId = new URLSearchParams(window.location.search).get('product');
    if (!productId || !uuidPattern.test(productId)) return notice('Choose a valid product listing.', true);
    let result = await supabase
        .from('products')
        .select('id, seller_id, seller_name, name, description, category, price_ugx, stock, image_url, image_urls, specifications, is_published')
        .eq('id', productId)
        .eq('is_published', true)
        .maybeSingle();
    if (needsProductCatalogMigration(result.error)) {
        productCatalogMigrationRequired = true;
        result = await supabase
            .from('products')
            .select('id, seller_id, seller_name, name, description, category, price_ugx, stock, image_url, is_published')
            .eq('id', productId)
            .eq('is_published', true)
            .maybeSingle();
    }
    if (result.error) throw result.error;
    const product = result.data ? {
        ...result.data,
        image_urls: result.data.image_urls || [],
        specifications: result.data.specifications || {}
    } : null;
    if (!product) return notice('This product is no longer available.', true);
    const images = productImages(product);
    if (!images.length) images.push(product.image_url);
    content.innerHTML = `<article class="portal-product-detail">
        <section class="portal-product-gallery" aria-label="Product photos">
            <img class="portal-product-gallery-main" id="productGalleryMain" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}">
            ${images.length > 1 ? `<div class="portal-product-gallery-thumbnails" role="group" aria-label="Choose a product photo">${images.map((image, index) => `<button type="button" data-product-image-index="${index}" aria-label="View product photo ${index + 1}" aria-pressed="${index === 0}"><img src="${escapeHTML(image)}" alt=""></button>`).join('')}</div>` : ''}
        </section>
        <div><p class="portal-eyebrow">${escapeHTML(product.category)} · ${escapeHTML(product.seller_name)}</p>
        <h2>${escapeHTML(product.name)}</h2><p>${escapeHTML(product.description || 'Contact the seller for more details.')}</p>
        <strong>${money(product.price_ugx)}</strong><p>${Number(product.stock) > 0 ? `${Number(product.stock)} in stock` : 'Out of stock'}</p>
        <p><a class="portal-card-link" href="${rootPath}pages/mini-shops/shop-page.html?seller=${encodeURIComponent(product.seller_id)}">Visit ${escapeHTML(product.seller_name)}'s shop</a></p>
        ${renderProductSpecifications(product.specifications, product.category)}
        <div class="portal-product-actions">
            <button type="button" id="detailAddToCart" ${Number(product.stock) > 0 ? '' : 'disabled'}>Add to bag</button>
            ${currentUser?.id === product.seller_id
                ? '<span class="portal-product-owner">Your listing</span>'
                : currentUser
                    ? '<button type="button" class="portal-message-seller" id="detailMessageSeller">Message seller</button>'
                    : `<a class="portal-message-seller" href="${sellerLoginPath(product.id)}">Sign in to message seller</a>`}
        </div>
        <a class="portal-card-link" href="${rootPath}pages/marketplace/index.html">Back to marketplace</a></div>
    </article><p id="productDetailStatus" class="portal-form-message" role="status" aria-live="polite"></p>`;
    const gallery = content.querySelector('.portal-product-gallery-thumbnails');
    gallery?.addEventListener('click', event => {
        const thumbnail = event.target.closest('[data-product-image-index]');
        if (!thumbnail) return;
        const imageIndex = Number(thumbnail.dataset.productImageIndex);
        const mainImage = document.getElementById('productGalleryMain');
        if (!Number.isInteger(imageIndex) || !images[imageIndex] || !mainImage) return;
        mainImage.src = images[imageIndex];
        gallery.querySelectorAll('[data-product-image-index]').forEach(button => {
            button.setAttribute('aria-pressed', String(button === thumbnail));
        });
    });
    document.getElementById('detailAddToCart').addEventListener('click', event => {
        const status = document.getElementById('productDetailStatus');
        try {
            const cart = readCart();
            const existing = cart.find(item => item.id === product.id);
            if ((existing ? existing.quantity : 0) >= Math.min(Number(product.stock), 99)) {
                statusMessage(status, 'You have added all available stock to your bag.', true);
                return;
            }
            if (existing) existing.quantity += 1;
            else cart.push({ id: product.id, quantity: 1 });
            saveCart(cart);
            event.currentTarget.textContent = 'Added to bag';
            statusMessage(status, 'Product added to your bag.');
        } catch (error) {
            console.error('Unable to add this product to the bag.', error);
            statusMessage(status, error.message, true);
        }
    });
    const messageButton = document.getElementById('detailMessageSeller');
    messageButton?.addEventListener('click', async () => {
        const status = document.getElementById('productDetailStatus');
        messageButton.disabled = true;
        statusMessage(status, 'Opening a private conversation…');
        try {
            const { data, error: conversationError } = await supabase.rpc('get_or_create_seller_conversation', {
                p_product_id: product.id
            });
            if (conversationError) throw conversationError;
            const conversationId = data?.[0]?.conversation_id;
            if (!conversationId || !uuidPattern.test(conversationId)) {
                throw new Error('The seller conversation could not be opened.');
            }
            window.location.href = `${rootPath}pages/messages/conversation.html?conversation=${encodeURIComponent(conversationId)}`;
        } catch (error) {
            console.error('Unable to open a seller conversation.', error);
            statusMessage(status, error.message || 'The seller conversation could not be opened.', true);
            messageButton.disabled = false;
        }
    });
}

function updateRouteHeading(title, subtitle) {
    document.title = `${title} | Primus`;
    const bannerHeading = document.querySelector('.portal-banner h1');
    if (bannerHeading) bannerHeading.textContent = title;
    for (const id of ['portalPageTitle', 'portalPageHeading']) {
        const node = document.getElementById(id);
        if (node) node.textContent = title;
    }
    const description = document.getElementById('portalDescription');
    if (description && subtitle) description.textContent = subtitle;
}

function renderStorefrontPreview() {
    const demoProducts = [
        { name: 'Linen Blend Shirt', category: 'Fashion', price: 145000, stock: 7, image: 'https://images.unsplash.com/photo-1598554747436-c9293d6a588f?auto=format&fit=crop&w=600&q=80' },
        { name: 'Handwoven Everyday Tote', category: 'Accessories', price: 89000, stock: 11, image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=600&q=80' },
        { name: 'Soft Form Ceramic Vase', category: 'Home', price: 72000, stock: 4, image: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=600&q=80' }
    ];
    updateRouteHeading('Mirembe Studio', 'A sample storefront showing how a Primus shop presents its products and public contact details.');
    content.innerHTML = `<section class="portal-storefront">
        <div class="portal-storefront-header"><span class="portal-storefront-mark" aria-hidden="true">M</span><div><p class="portal-eyebrow">Sample shop · Kampala</p><h2>Mirembe Studio</h2><p>Thoughtful everyday pieces from an independent Ugandan shop.</p></div></div>
        <div class="portal-storefront-contact"><p><strong>Shop phone</strong><span>+256 700 123 456 · sample contact</span></p><p><strong>Shop location</strong><span>Kololo, Kampala · Sample address: Plot 14 Market Lane</span></p><p><strong>Returns</strong><span>Approved returns are brought to the shop within 3 days of delivery.</span></p></div>
        <p class="portal-callout">This is a demonstration storefront. A seller's live shop appears here after administrator approval and publishing shop details and products.</p>
        <h3 class="portal-section-title">Featured products</h3>
        <div class="portal-products">${demoProducts.map(product => `<article class="portal-product">
            <a href="${rootPath}pages/marketplace/index.html"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy"></a>
            <div><small>${escapeHTML(product.category)} · Mirembe Studio · sample</small><h3><a href="${rootPath}pages/marketplace/index.html">${escapeHTML(product.name)}</a></h3>
            <p>${money(product.price)} <span>${product.stock} in stock</span></p><a class="portal-card-link" href="${rootPath}pages/marketplace/index.html">Browse marketplace</a></div>
        </article>`).join('')}</div>
        <p><a class="portal-action" href="${rootPath}pages/auth/seller-register.html">Open a shop on Primus</a></p>
    </section>`;
}

async function initializeStorefront() {
    if (route !== 'pages/mini-shops/shop-page.html') return;
    const sellerId = new URLSearchParams(window.location.search).get('seller');
    if (!sellerId) {
        renderStorefrontPreview();
        return;
    }
    if (!uuidPattern.test(sellerId)) return notice('Choose a valid seller storefront.', true);
    const { data: shops, error: shopError } = await supabase.rpc('get_public_seller_shop', { p_seller_id: sellerId });
    if (shopError) throw shopError;
    const shop = Array.isArray(shops) ? shops[0] : shops;
    if (!shop) return notice('This shop is unavailable or has not been approved for public view.', true);

    let result = await supabase
        .from('products')
        .select('id, seller_id, seller_name, name, description, category, price_ugx, stock, image_url, image_urls, specifications, is_published, created_at')
        .eq('seller_id', sellerId)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(100);
    if (needsProductCatalogMigration(result.error)) {
        productCatalogMigrationRequired = true;
        result = await supabase
            .from('products')
            .select('id, seller_id, seller_name, name, description, category, price_ugx, stock, image_url, is_published, created_at')
            .eq('seller_id', sellerId)
            .eq('is_published', true)
            .order('created_at', { ascending: false })
            .limit(100);
    }
    if (result.error) throw result.error;
    const phone = String(shop.contact_phone || '');
    const tel = phone.replace(/[^\d+]/g, '');
    const location = [shop.area, shop.city, shop.district].filter(Boolean).join(', ');
    updateRouteHeading(shop.shop_name, shop.description || `Shop local products from ${shop.shop_name}.`);
    content.innerHTML = `<section class="portal-storefront">
        <div class="portal-storefront-header"><span class="portal-storefront-mark" aria-hidden="true">${escapeHTML(shop.shop_name.slice(0, 1).toUpperCase())}</span><div><p class="portal-eyebrow">Verified Primus seller</p><h2>${escapeHTML(shop.shop_name)}</h2><p>${escapeHTML(shop.description || 'Welcome to our Primus shop.')}</p></div></div>
        <div class="portal-storefront-contact"><p><strong>Shop phone</strong><span><a href="tel:${escapeHTML(tel)}">${escapeHTML(phone)}</a></span></p><p><strong>Shop location</strong><span>${escapeHTML(location)}<br>${escapeHTML(shop.address)}</span></p><p><strong>Returns</strong><span>Bring an approved return to this shop within the 3-day return period.</span></p></div>
        <h3 class="portal-section-title">Products from this shop</h3>
        ${renderProductCards(result.data || [])}
        <p id="storefrontStatus" class="portal-form-message" role="status" aria-live="polite"></p>
    </section>`;
    content.onclick = event => {
        const button = event.target.closest('[data-commerce-add]');
        if (!button) return;
        const product = (result.data || []).find(item => item.id === button.dataset.commerceAdd);
        if (!product) return;
        try {
            const cart = readCart();
            const existing = cart.find(item => item.id === product.id);
            if ((existing ? existing.quantity : 0) >= Math.min(Number(product.stock), 99)) {
                statusMessage(document.getElementById('storefrontStatus'), 'You have added all available stock to your bag.', true);
                return;
            }
            if (existing) existing.quantity += 1;
            else cart.push({ id: product.id, quantity: 1 });
            saveCart(cart);
            button.textContent = 'Added';
            statusMessage(document.getElementById('storefrontStatus'), `${product.name} added to your bag.`);
        } catch (error) {
            console.error('Unable to add a storefront product to the bag.', error);
            statusMessage(document.getElementById('storefrontStatus'), error.message, true);
        }
    };
}

async function initializeShopProfile() {
    if (route !== 'pages/seller-dashboard/shop-profile.html') return;
    const profile = await requireRole(null);
    if (!profile || !currentUser) return;
    if (!['seller', 'admin'].includes(currentRole)) {
        notice('Shop profiles are available to approved sellers and the Primus administrator.', true);
        return;
    }
    const { data: shop, error } = await supabase
        .from('seller_shops')
        .select('shop_name, description, contact_phone, district, city, area, address, is_public')
        .eq('seller_id', currentUser.id)
        .maybeSingle();
    if (error) throw error;
    updateRouteHeading('Shop Profile', 'Edit the public contact, location, and details shown on your storefront.');
    content.innerHTML = `<form class="portal-form portal-shop-profile" id="shopProfileForm">
        <label class="form-field">Shop name<input name="shop_name" type="text" maxlength="160" value="${escapeHTML(shop?.shop_name || profile.shop_name || '')}" required></label>
        <label class="form-field">Public contact phone<input name="contact_phone" type="tel" maxlength="40" value="${escapeHTML(shop?.contact_phone || profile.phone_number || '')}" required></label>
        <label class="form-field">District<input name="district" type="text" maxlength="100" value="${escapeHTML(shop?.district || '')}" required></label>
        <label class="form-field">City or town<input name="city" type="text" maxlength="100" value="${escapeHTML(shop?.city || '')}" required></label>
        <label class="form-field">Area or neighbourhood<input name="area" type="text" maxlength="120" value="${escapeHTML(shop?.area || '')}" required></label>
        <label class="form-field full-width">Full public shop address<input name="address" type="text" maxlength="300" value="${escapeHTML(shop?.address || '')}" required></label>
        <label class="form-field full-width">Shop description<textarea name="description" maxlength="1000" rows="4">${escapeHTML(shop?.description || '')}</textarea></label>
        <label class="portal-terms-consent full-width"><input name="is_public" type="checkbox" ${shop?.is_public === false ? '' : 'checked'}><span>Show this shop publicly on Primus. The full address and contact phone above are visible to visitors.</span></label>
        <p class="form-note full-width">The 5% commission is deducted from eligible Flutterwave Mobile Money settlements and is not reversed for returns. Cash-on-delivery commission collection remains manual.</p>
        <button type="submit">Save shop profile</button>
        <a class="portal-card-link" href="${rootPath}pages/mini-shops/shop-page.html?seller=${encodeURIComponent(currentUser.id)}">View public shop</a>
        <p class="portal-form-message full-width" id="shopProfileStatus" role="status" aria-live="polite"></p>
    </form>`;
    const form = document.getElementById('shopProfileForm');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const value = name => form.elements.namedItem(name).value.trim();
            const { error: saveError } = await supabase.rpc('save_seller_shop_profile', {
                p_shop_name: value('shop_name'),
                p_description: value('description'),
                p_contact_phone: value('contact_phone'),
                p_district: value('district'),
                p_city: value('city'),
                p_area: value('area'),
                p_address: value('address'),
                p_is_public: form.elements.is_public.checked
            });
            if (saveError) throw saveError;
            statusMessage(document.getElementById('shopProfileStatus'), 'Shop profile saved.');
        } catch (saveError) {
            console.error('Unable to save the seller shop profile.', saveError);
            statusMessage(document.getElementById('shopProfileStatus'), `Shop profile could not be saved: ${saveError.message}`, true);
        } finally {
            button.disabled = false;
        }
    });
}

function sellerLoginPath(productId) {
    const login = new URL(`${rootPath}pages/auth/login.html`, window.location.href);
    login.searchParams.set('redirect', `${rootPath}pages/products/product-details.html?product=${encodeURIComponent(productId)}`);
    return login.href;
}

async function loadProducts({ query = '', category = '', minPrice = '', maxPrice = '', ids = null, limit = 100 } = {}) {
    const buildRequest = columns => {
        let request = supabase
            .from('products')
            .select(columns)
            .eq('is_published', true)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (query.trim()) request = request.textSearch('search_vector', query.trim(), { type: 'websearch', config: 'simple' });
        if (category) request = request.eq('category', category);
        if (minPrice !== '' && Number.isFinite(Number(minPrice))) request = request.gte('price_ugx', Number(minPrice));
        if (maxPrice !== '' && Number.isFinite(Number(maxPrice))) request = request.lte('price_ugx', Number(maxPrice));
        if (ids) request = request.in('id', ids);
        return request;
    };
    let result = await buildRequest('id, seller_id, seller_name, name, description, category, price_ugx, stock, image_url, image_urls, specifications, is_published, created_at');
    if (needsProductCatalogMigration(result.error)) {
        productCatalogMigrationRequired = true;
        result = await buildRequest('id, seller_id, seller_name, name, description, category, price_ugx, stock, image_url, is_published, created_at');
    }
    if (result.error) throw result.error;
    return (result.data || []).map(product => ({
        ...product,
        image_urls: product.image_urls || [],
        specifications: product.specifications || {}
    }));
}

async function initializeMarketplace() {
    if (document.body.dataset.sitePage !== 'marketplace') return;
    try {
        const products = await loadProducts();
        if (productCatalogMigrationRequired) {
            const results = document.querySelector('.product-results');
            if (results) results.prepend(element('p', 'catalog-live-note', 'Run product-catalog-migration.sql in Supabase to enable product specs and multi-photo galleries.'));
        }
        if (!products.length) return;
        window.dispatchEvent(new CustomEvent('primus:catalog-updated', { detail: products.map(toMarketplaceProduct) }));
        const url = new URL(window.location.href);
        const search = url.searchParams.get('q');
        if (search) {
            const input = document.getElementById('catalogSearch');
            if (input) {
                input.value = search;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    } catch (error) {
        console.error('Unable to load public marketplace products.', error);
        const results = document.querySelector('.product-results');
        if (results) {
            const guidance = error.code === '42703'
                ? 'Live product data needs the latest catalog schema. Run product-catalog-migration.sql in Supabase.'
                : 'Live listings could not be loaded. Check the Supabase connection and migrations.';
            const note = element('p', 'catalog-live-note', `Showing sample products. ${guidance}`);
            results.prepend(note);
        }
    }
}

async function initializeSearchPage() {
    if (!route.startsWith('pages/search/') && route !== 'pages/products/all-products.html') return;
    const queryFromUrl = new URLSearchParams(window.location.search).get('q') || '';
    content.innerHTML = `<form class="portal-live-search" id="commerceSearchForm">
        <label for="commerceSearchQuery">Search products and shops</label>
        <div><input id="commerceSearchQuery" type="search" value="${escapeHTML(queryFromUrl)}" placeholder="Try a product, category, or shop">
        <button type="submit">Search</button></div>
        <label for="commerceSearchCategory">Category</label>
        <select id="commerceSearchCategory"><option value="">All categories</option><option>Fashion</option><option>Electronics</option><option>Home</option><option>Beauty</option><option>Groceries</option><option>Services</option></select>
        <div class="portal-live-price"><label>Minimum UGX<input id="commerceMinPrice" type="number" min="0"></label><label>Maximum UGX<input id="commerceMaxPrice" type="number" min="0"></label></div>
    </form><p id="commerceSearchStatus" class="portal-form-message" role="status" aria-live="polite"></p><div id="commerceSearchResults"></div>`;
    const form = document.getElementById('commerceSearchForm');
    const results = document.getElementById('commerceSearchResults');
    const searchStatus = document.getElementById('commerceSearchStatus');
    let timer;
    let productsForCurrentResults = [];
    const runSearch = async () => {
        const query = document.getElementById('commerceSearchQuery').value.trim();
        statusMessage(searchStatus, 'Searching published seller listings…');
        try {
            const products = await loadProducts({
                query,
                category: document.getElementById('commerceSearchCategory').value,
                minPrice: document.getElementById('commerceMinPrice').value,
                maxPrice: document.getElementById('commerceMaxPrice').value
            });
            productsForCurrentResults = products;
            results.innerHTML = renderProductCards(products);
            statusMessage(searchStatus, `${products.length} ${products.length === 1 ? 'result' : 'results'}`);
        } catch (error) {
            console.error('Marketplace search failed.', error);
            results.replaceChildren();
            statusMessage(searchStatus, `Search is unavailable: ${error.message}`, true);
        }
    };
    form.addEventListener('submit', event => {
        event.preventDefault();
        void runSearch();
    });
    form.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void runSearch(), 250);
    });
    form.addEventListener('change', () => void runSearch());
    results.addEventListener('click', event => {
        const button = event.target.closest('[data-commerce-add]');
        if (!button) return;
        try {
            const cart = readCart();
            const existing = cart.find(item => item.id === button.dataset.commerceAdd);
            const product = productsForCurrentResults.find(item => item.id === button.dataset.commerceAdd);
            if (!product || Math.min(Number(product.stock), 99) < (existing ? existing.quantity + 1 : 1)) {
                statusMessage(searchStatus, 'This listing has no more stock available.', true);
                return;
            }
            if (existing) existing.quantity += 1;
            else cart.push({ id: button.dataset.commerceAdd, quantity: 1 });
            saveCart(cart);
            button.textContent = 'Added';
            window.setTimeout(() => { if (button.isConnected) button.textContent = 'Add to bag'; }, 1200);
        } catch (error) {
            console.error('Unable to add a product to the bag.', error);
            statusMessage(searchStatus, error.message, true);
        }
    });
    await runSearch();
}

function signedOutPrompt(feature) {
    const link = `${rootPath}pages/auth/login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    content.innerHTML = `<div class="portal-cart-empty"><h3>Sign in to continue</h3><p>${escapeHTML(feature)} is available to signed-in Primus customers.</p><a class="portal-action" href="${link}">Sign in</a></div>`;
}

async function requireRole(role) {
    if (!currentUser) {
        signedOutPrompt('This feature');
        return false;
    }
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, shop_name')
        .eq('id', currentUser.id)
        .maybeSingle();
    if (error) throw error;
    currentRole = profile?.role || null;
    if (role && currentRole !== role) {
        notice(`This page requires an approved ${role} account. Your current role is ${currentRole || 'not assigned'}.`, true);
        return false;
    }
    return profile;
}

async function initializeProfileSettings() {
    if (route !== 'pages/buyer-dashboard/profile.html') return;
    if (!currentUser) {
        signedOutPrompt('Your profile');
        return;
    }

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('display_name, role, avatar_id')
        .eq('id', currentUser.id)
        .maybeSingle();
    if (error) throw error;
    if (!profile) {
        notice('Your Primus profile could not be found.', true);
        return;
    }

    const avatars = window.PRIMUS_AVATARS;
    if (!Array.isArray(avatars) || avatars.length === 0) {
        throw new Error('The profile avatar choices are unavailable.');
    }
    let selectedAvatar = avatars.some(avatar => avatar.id === profile.avatar_id)
        ? profile.avatar_id
        : avatars[0].id;
    const roleLabels = { buyer: 'Buyer', seller: 'Seller', rider: 'Rider', admin: 'Super administrator' };
    const selectedOption = () => avatars.find(avatar => avatar.id === selectedAvatar) || avatars[0];
    content.innerHTML = `<section class="portal-profile-settings">
        <div class="portal-profile-intro">
            <span class="portal-profile-avatar" id="profileAvatarPreview" data-avatar="${escapeHTML(selectedAvatar)}">${selectedOption().svg}</span>
            <div><p class="portal-eyebrow">Your account</p><h3>${escapeHTML(profile.display_name || currentUser.email || 'Primus member')}</h3>
            <p>${escapeHTML(roleLabels[profile.role] || 'Primus member')} · Choose an icon to personalize your account.</p></div>
        </div>
        <form id="profileAvatarForm" class="portal-profile-avatar-form">
            <fieldset><legend>Choose your profile icon</legend>
                <div class="portal-avatar-options" role="group" aria-label="Profile icon options">
                    ${avatars.map(avatar => `<button type="button" class="portal-avatar-option" data-avatar-id="${escapeHTML(avatar.id)}" aria-label="${escapeHTML(avatar.label)} avatar" aria-pressed="${avatar.id === selectedAvatar}"><span class="portal-profile-avatar" data-avatar="${escapeHTML(avatar.id)}">${avatar.svg}</span><small>${escapeHTML(avatar.label)}</small></button>`).join('')}
                </div>
            </fieldset>
            <button type="submit">Save profile icon</button>
            <p id="profileAvatarStatus" class="portal-form-message" role="status" aria-live="polite"></p>
        </form>
    </section>`;

    const preview = document.getElementById('profileAvatarPreview');
    const avatarButtons = [...content.querySelectorAll('[data-avatar-id]')];
    const status = document.getElementById('profileAvatarStatus');
    avatarButtons.forEach(button => button.addEventListener('click', () => {
        selectedAvatar = button.dataset.avatarId;
        const option = selectedOption();
        preview.dataset.avatar = option.id;
        preview.innerHTML = option.svg;
        avatarButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    }));

    document.getElementById('profileAvatarForm').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        statusMessage(status, 'Saving your profile icon…');
        try {
            const { error: saveError } = await supabase.rpc('update_primus_avatar', {
                p_avatar_id: selectedAvatar
            });
            if (saveError) throw saveError;
            const updatedProfile = { ...profile, avatar_id: selectedAvatar };
            if (typeof window.PRIMUS_UPDATE_ACCOUNT_UI === 'function') {
                window.PRIMUS_UPDATE_ACCOUNT_UI(currentUser, updatedProfile);
            }
            statusMessage(status, 'Profile icon saved.');
        } catch (saveError) {
            console.error('Unable to save the profile icon.', saveError);
            statusMessage(status, `Profile icon could not be saved: ${saveError.message || 'network error'}`, true);
        } finally {
            button.disabled = false;
        }
    });
}

async function initializeProductManagement() {
    const sellerRoute = /^pages\/seller-dashboard\/(products|inventory|stock|add-product|edit-product)\.html$/.test(route);
    const adminRoute = route === 'pages/admin/products.html';
    if (!sellerRoute && !adminRoute) return;
    const profile = await requireRole(null);
    if (!profile || !currentUser) return;
    if (adminRoute && currentRole !== 'admin') {
        notice('Only the Primus administrator can manage marketplace-wide products.', true);
        return;
    }
    if (sellerRoute && !['seller', 'admin'].includes(currentRole)) {
        notice('Product listings are available to approved sellers and the Primus administrator.', true);
        return;
    }
    const isAdmin = currentRole === 'admin';
    const search = new URLSearchParams(window.location.search);
    const isFormRoute = route.endsWith('/add-product.html')
        || route.endsWith('/edit-product.html')
        || (adminRoute && (search.get('action') === 'add' || search.has('product')));
    if (isFormRoute) {
        await renderProductForm(profile, isAdmin);
        return;
    }
    await renderSellerProductList(isAdmin);
}

async function renderSellerProductList(isAdmin = false) {
    let request = supabase
        .from('products')
        .select('id, seller_id, seller_name, name, category, price_ugx, stock, image_url, is_published, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
    if (!isAdmin) request = request.eq('seller_id', currentUser.id);
    const { data: products, error } = await request;
    if (error) throw error;
    const rows = products || [];
    const addPath = isAdmin
        ? `${rootPath}pages/admin/products.html?action=add`
        : `${rootPath}pages/seller-dashboard/add-product.html`;
    const editPath = product => isAdmin
        ? `${rootPath}pages/admin/products.html?product=${encodeURIComponent(product.id)}`
        : `${rootPath}pages/seller-dashboard/edit-product.html?product=${encodeURIComponent(product.id)}`;
    content.innerHTML = `<div class="portal-live-toolbar"><p>${isAdmin ? 'Review and manage product listings across Primus.' : 'Manage your listings and stock. New products start as drafts.'}</p><a class="portal-action" href="${addPath}">Add a product</a></div>
        ${rows.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr>${isAdmin ? '<th>Seller</th>' : ''}<th>Product</th><th>Price</th><th>Stock</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>${rows.map(product => `<tr>
            ${isAdmin ? `<td>${escapeHTML(product.seller_name)}</td>` : ''}
            <td><span class="portal-live-product"><img src="${escapeHTML(product.image_url)}" alt="">${escapeHTML(product.name)}</span></td>
            <td>${money(product.price_ugx)}</td><td>${Number(product.stock)}</td><td>${product.is_published ? 'Published' : 'Draft'}</td>
            <td class="portal-live-actions"><a href="${editPath(product)}">Edit</a>
            <button type="button" data-product-publish="${escapeHTML(product.id)}" data-published="${product.is_published}">${product.is_published ? 'Unpublish' : 'Publish'}</button>
            <button type="button" data-product-delete="${escapeHTML(product.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="portal-cart-empty"><h3>${isAdmin ? 'No product listings yet' : 'Your shop is ready for its first listing'}</h3><p>Add a product with clear photos and complete specifications.</p></div>`}
        <p id="sellerProductsStatus" class="portal-form-message" role="status" aria-live="polite"></p>`;
    content.onclick = async event => {
        const publishButton = event.target.closest('[data-product-publish]');
        const deleteButton = event.target.closest('[data-product-delete]');
        if (!publishButton && !deleteButton) return;
        const button = publishButton || deleteButton;
        button.disabled = true;
        const status = document.getElementById('sellerProductsStatus');
        try {
            let result;
            if (deleteButton) {
                let lookup = supabase.from('products').select('image_url, image_urls').eq('id', deleteButton.dataset.productDelete);
                if (!isAdmin) lookup = lookup.eq('seller_id', currentUser.id);
                const { data: product, error: lookupError } = await lookup.maybeSingle();
                if (lookupError) throw lookupError;
                if (!product) throw new Error('This product listing could not be found.');
                const imagePaths = productImages(product).map(storageImagePath).filter(Boolean);
                let query = supabase.from('products').delete().eq('id', deleteButton.dataset.productDelete);
                if (!isAdmin) query = query.eq('seller_id', currentUser.id);
                result = await query;
                if (result.error) throw result.error;
                await renderSellerProductList(isAdmin);
                if (imagePaths.length) {
                    try {
                        const { error: cleanupError } = await supabase.storage.from('product-images').remove(imagePaths);
                        if (cleanupError) {
                            console.error('Product was deleted, but its images could not be removed from storage.', cleanupError);
                            statusMessage(document.getElementById('sellerProductsStatus'), 'Product deleted, but some photos could not be removed from storage.', true);
                        }
                    } catch (cleanupError) {
                        console.error('Product was deleted, but its images could not be removed from storage.', cleanupError);
                        statusMessage(document.getElementById('sellerProductsStatus'), 'Product deleted, but some photos could not be removed from storage.', true);
                    }
                }
                return;
            } else {
                let query = supabase.from('products')
                    .update({ is_published: publishButton.dataset.published !== 'true', updated_at: new Date().toISOString() })
                    .eq('id', publishButton.dataset.productPublish);
                if (!isAdmin) query = query.eq('seller_id', currentUser.id);
                result = await query;
            }
            if (result.error) throw result.error;
            await renderSellerProductList(isAdmin);
        } catch (error) {
            console.error('Unable to update a product listing.', error);
            button.disabled = false;
            statusMessage(status, error.message, true);
        }
    };
}

function renderProductSpecificationFields(category, specifications) {
    const fields = productCategorySpecs[category] || [];
    if (!fields.length) return '<p class="form-note">Choose a category to enter its product-specific details.</p>';
    return `<fieldset class="portal-product-specifications full-width"><legend>${escapeHTML(category)} specifications</legend><div class="portal-product-spec-fields">${fields.map(([key, label, type = 'text']) => `<label class="form-field">${escapeHTML(label)}<input data-specification-key="${key}" type="${type}" maxlength="240" value="${escapeHTML(specifications[key] || '')}"></label>`).join('')}</div></fieldset>`;
}

function renderProductImagePreviews(images) {
    const gallery = document.getElementById('productImagePreviews');
    if (!gallery) return;
    gallery.innerHTML = images.map((image, index) => `<article class="portal-product-image-preview">
        <img src="${escapeHTML(image.preview)}" alt="Product photo ${index + 1}">
        <div><span>${index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</span>
        ${index ? `<button type="button" data-image-primary="${index}">Make cover</button>` : ''}
        <button type="button" data-image-remove="${index}" aria-label="Remove photo ${index + 1}">Remove</button></div>
    </article>`).join('');
}

function readProductSpecifications(form) {
    return Object.fromEntries([...form.querySelectorAll('[data-specification-key]')]
        .map(input => [input.dataset.specificationKey, input.value.trim()])
        .filter(([, value]) => value));
}

function storageImagePath(publicUrl) {
    const configUrl = window.PRIMUS_SUPABASE_CONFIG?.url;
    if (!configUrl) return null;
    try {
        const image = new URL(publicUrl);
        const project = new URL(configUrl);
        const bucketPrefix = `${project.pathname.replace(/\/$/, '')}/storage/v1/object/public/product-images/`;
        if (image.origin !== project.origin || !image.pathname.startsWith(bucketPrefix)) return null;
        return decodeURIComponent(image.pathname.slice(bucketPrefix.length));
    } catch (error) {
        console.error('Unable to parse a product image URL for storage cleanup.', error);
        return null;
    }
}

async function renderProductForm(profile, isAdmin = false) {
    const productId = new URLSearchParams(window.location.search).get('product');
    let existing = null;
    if (productId) {
        if (!uuidPattern.test(productId)) {
            notice('The product reference is invalid.', true);
            return;
        }
        let query = supabase.from('products').select('*').eq('id', productId);
        if (!isAdmin) query = query.eq('seller_id', currentUser.id);
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (!data) {
            notice(isAdmin ? 'This product listing was not found.' : 'This product was not found in your shop.', true);
            return;
        }
        existing = data;
    }
    const images = existing ? productImages(existing).map(url => ({ url, preview: url, file: null })) : [];
    let specifications = existing?.specifications && typeof existing.specifications === 'object'
        ? { ...existing.specifications }
        : {};
    content.innerHTML = `<form class="portal-form portal-product-editor" id="sellerProductForm">
        <label class="form-field full-width">${isAdmin ? 'Seller / shop name shown on listings' : 'Shop name shown on listings'}<input name="seller_name" type="text" maxlength="160" required value="${escapeHTML(existing?.seller_name || profile.shop_name || (isAdmin ? 'Primus Official' : ''))}"></label>
        <label class="form-field full-width">Product name<input name="name" type="text" maxlength="160" required value="${escapeHTML(existing?.name || '')}"></label>
        <label class="form-field">Category<select name="category" required><option value="">Choose category</option>${Object.keys(productCategorySpecs).map(category => `<option${existing?.category === category ? ' selected' : ''}>${category}</option>`).join('')}</select></label>
        <label class="form-field">Price (UGX)<input name="price_ugx" type="number" min="1" step="1" required value="${escapeHTML(existing?.price_ugx || '')}"></label>
        <label class="form-field">Available stock<input name="stock" type="number" min="0" step="1" required value="${escapeHTML(existing?.stock ?? 1)}"></label>
        <label class="form-field full-width">Product photos<input name="product_images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple><span class="form-note">Add up to ${productImageLimit} photos, 5 MB each. The cover photo appears first in the product gallery.</span></label>
        <div class="portal-product-image-grid full-width" id="productImagePreviews" aria-live="polite"></div>
        <label class="form-field full-width">Description<textarea name="description" maxlength="5000" rows="5">${escapeHTML(existing?.description || '')}</textarea></label>
        <div class="portal-product-specification-host full-width" id="productSpecificationFields"></div>
        <label class="check-filter full-width"><input name="is_published" type="checkbox"${existing?.is_published ? ' checked' : ''}><span>Publish this product in the marketplace</span></label>
        <p class="form-note">${isAdmin ? 'Admin listings use the shop name above. Prices are entered in whole UGX.' : 'Only approved seller accounts can create or publish listings. Prices are entered in whole UGX.'}</p>
        <button type="submit">${existing ? 'Save product' : 'Create product'}</button><p id="sellerProductStatus" class="portal-form-message" role="status" aria-live="polite"></p>
    </form>`;
    const form = document.getElementById('sellerProductForm');
    const categorySelect = form.elements.category;
    const specificationHost = document.getElementById('productSpecificationFields');
    const imageInput = form.elements.product_images;
    const status = document.getElementById('sellerProductStatus');
    const saveButton = form.querySelector('button[type="submit"]');
    const renderSpecifications = () => {
        specificationHost.innerHTML = renderProductSpecificationFields(categorySelect.value, specifications);
    };
    renderSpecifications();
    renderProductImagePreviews(images);
    categorySelect.addEventListener('change', () => {
        Object.assign(specifications, readProductSpecifications(form));
        renderSpecifications();
    });
    imageInput.addEventListener('change', () => {
        const additions = [...imageInput.files];
        imageInput.value = '';
        if (images.length + additions.length > productImageLimit) {
            statusMessage(status, `A product can have up to ${productImageLimit} photos.`, true);
            return;
        }
        const invalid = additions.find(file => !productImageTypes.has(file.type) || file.size > productImageMaxBytes);
        if (invalid) {
            statusMessage(status, `${invalid.name} is not a supported image or exceeds the 5 MB limit. Use JPEG, PNG, WebP, or AVIF.`, true);
            return;
        }
        for (const file of additions) images.push({ file, preview: URL.createObjectURL(file), url: null });
        renderProductImagePreviews(images);
        statusMessage(status, `${images.length} photo${images.length === 1 ? '' : 's'} selected.`);
    });
    document.getElementById('productImagePreviews').addEventListener('click', event => {
        const primaryButton = event.target.closest('[data-image-primary]');
        const removeButton = event.target.closest('[data-image-remove]');
        if (!primaryButton && !removeButton) return;
        const button = primaryButton || removeButton;
        const index = Number(primaryButton ? button.dataset.imagePrimary : button.dataset.imageRemove);
        if (!Number.isInteger(index) || !images[index]) return;
        if (primaryButton) images.unshift(images.splice(index, 1)[0]);
        else {
            const [removed] = images.splice(index, 1);
            if (removed.file) URL.revokeObjectURL(removed.preview);
        }
        renderProductImagePreviews(images);
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!images.length) {
            statusMessage(status, 'Add at least one product photo before saving.', true);
            return;
        }
        saveButton.disabled = true;
        const values = new FormData(form);
        const uploadedPaths = [];
        let productSaved = false;
        try {
            const imageUrls = [];
            for (const [index, image] of images.entries()) {
                if (image.file) {
                    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[image.file.type];
                    const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
                    statusMessage(status, `Uploading photo ${index + 1} of ${images.length}…`);
                    const { error: uploadError } = await supabase.storage.from('product-images').upload(path, image.file, {
                        cacheControl: '3600',
                        contentType: image.file.type,
                        upsert: false
                    });
                    if (uploadError) throw uploadError;
                    uploadedPaths.push(path);
                    imageUrls.push(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl);
                } else {
                    imageUrls.push(image.url);
                }
            }
            const payload = {
                seller_id: existing?.seller_id || currentUser.id,
                seller_name: String(values.get('seller_name')).trim(),
                name: String(values.get('name')).trim(),
                category: String(values.get('category')).trim(),
                description: String(values.get('description')).trim(),
                price_ugx: Number(values.get('price_ugx')),
                stock: Number(values.get('stock')),
                image_url: imageUrls[0],
                image_urls: imageUrls,
                specifications: readProductSpecifications(form),
                is_published: values.get('is_published') === 'on',
                updated_at: new Date().toISOString()
            };
            const result = existing
                ? await (isAdmin
                    ? supabase.from('products').update(payload).eq('id', existing.id)
                    : supabase.from('products').update(payload).eq('id', existing.id).eq('seller_id', currentUser.id))
                    .select('id').maybeSingle()
                : await supabase.from('products').insert(payload).select('id').single();
            if (result.error) throw result.error;
            if (!result.data) throw new Error('No product was saved. Check that you still have permission to edit this listing.');
            productSaved = true;
            const savedUrls = new Set(imageUrls);
            const removedPaths = existing
                ? productImages(existing).filter(url => !savedUrls.has(url)).map(storageImagePath).filter(Boolean)
                : [];
            if (removedPaths.length) {
                const { error: cleanupError } = await supabase.storage.from('product-images').remove(removedPaths);
                if (cleanupError) {
                    console.error('Product was saved, but removed product images could not be deleted.', cleanupError);
                    statusMessage(status, 'Product saved, but some removed photos could not be deleted from storage. Please contact support.', true);
                    saveButton.disabled = false;
                    return;
                }
            }
            for (const image of images) {
                if (image.file) URL.revokeObjectURL(image.preview);
            }
            window.location.href = isAdmin
                ? `${rootPath}pages/admin/products.html`
                : `${rootPath}pages/seller-dashboard/products.html`;
        } catch (error) {
            if (productSaved) {
                console.error('Product was saved, but product image cleanup failed.', error);
                statusMessage(status, 'Product saved, but some removed photos could not be deleted from storage. Please contact support.', true);
                saveButton.disabled = false;
                return;
            }
            console.error('Unable to save the product listing.', error);
            const migrationMissing = needsProductCatalogMigration(error) || /bucket not found/i.test(error.message || '');
            statusMessage(status, migrationMissing
                ? 'Product could not be saved. Run product-catalog-migration.sql in Supabase, then try again.'
                : `Product could not be saved: ${error.message}`, true);
            if (uploadedPaths.length) {
                try {
                    const { error: cleanupError } = await supabase.storage.from('product-images').remove(uploadedPaths);
                    if (cleanupError) console.error('Uploaded product images could not be cleaned up after the listing save failed.', cleanupError);
                } catch (cleanupError) {
                    console.error('Uploaded product images could not be cleaned up after the listing save failed.', cleanupError);
                }
            }
            saveButton.disabled = false;
        }
    });
}

function statusLabel(status) {
    return String(status || '').replace(/_/g, ' ');
}

function orderLink(order, group) {
    const path = group === 'seller'
        ? `${rootPath}pages/seller-dashboard/order-details.html?order=${encodeURIComponent(order.id)}`
        : `${rootPath}pages/buyer-dashboard/order-details.html?order=${encodeURIComponent(order.id)}`;
    return `<a class="portal-live-order" href="${path}"><span><strong>Order #${escapeHTML(order.id.slice(0, 8).toUpperCase())}</strong><small>${escapeHTML(statusLabel(order.status))} · ${time(order.created_at)}</small></span><strong>${money(order.total_ugx)}</strong></a>`;
}

async function initializeOrders() {
    const buyerList = route === 'pages/buyer-dashboard/orders.html';
    const sellerList = route === 'pages/seller-dashboard/orders.html' || route === 'pages/seller-dashboard/fulfilment.html';
    const details = route === 'pages/buyer-dashboard/order-details.html' || route === 'pages/seller-dashboard/order-details.html';
    if (!buyerList && !sellerList && !details) return;
    if (!currentUser) return signedOutPrompt('Your orders');
    if (sellerList || route === 'pages/seller-dashboard/order-details.html') {
        const approved = await requireRole('seller');
        if (!approved || currentRole !== 'seller') return;
    }
    if (details) {
        await renderOrderDetails();
        return;
    }
    const column = sellerList ? 'seller_id' : 'buyer_id';
    const ordersQuery = supabase
        .from('orders')
        .select('id, status, payment_method, payment_status, total_ugx, created_at')
        .eq(column, currentUser.id);
    const visibleOrdersQuery = sellerList
        ? ordersQuery.or('payment_method.eq.cash_on_delivery,payment_status.eq.paid')
        : ordersQuery;
    const { data: orders, error } = await visibleOrdersQuery
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    content.innerHTML = `<div class="portal-live-order-list">${(orders || []).map(order => orderLink(order, sellerList ? 'seller' : 'buyer')).join('') || '<div class="portal-cart-empty"><h3>No orders yet</h3><p>Orders will appear here after checkout.</p><a class="portal-action" href="../../pages/marketplace/index.html">Explore the marketplace</a></div>'}</div>`;
}

async function renderOrderDetails() {
    const orderId = new URLSearchParams(window.location.search).get('order');
    if (!orderId || !uuidPattern.test(orderId)) return notice('Choose a valid order from your order list.', true);
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (error) throw error;
    if (!order) return notice('This order is not available to your account.', true);
    const sellerView = route.startsWith('pages/seller-dashboard/');
    let paymentRetry = '';
    if (!sellerView && order.payment_method === 'mobile_money' && order.payment_status === 'processing') {
        const { data: attempts, error: paymentError } = await supabase
            .from('payment_attempts')
            .select('provider_reference')
            .eq('order_id', order.id)
            .eq('buyer_id', currentUser.id)
            .limit(1);
        if (paymentError) throw paymentError;
        const reference = attempts?.[0]?.provider_reference;
        if (reference) {
            paymentRetry = `<p><a class="portal-card-link" href="${rootPath}pages/checkout/processing.html?tx_ref=${encodeURIComponent(reference)}">Check Mobile Money payment status</a></p>`;
        }
    }
    const { data: items, error: itemError } = await supabase
        .from('order_items')
        .select('id, product_name, unit_price_ugx, quantity, line_total_ugx, primus_commission_ugx')
        .eq('order_id', order.id)
        .order('created_at');
    if (itemError) throw itemError;
    const canRequestReturn = !sellerView
        && order.status === 'delivered'
        && order.delivered_at
        && Date.now() <= new Date(order.delivered_at).getTime() + 3 * 24 * 60 * 60 * 1000;
    content.innerHTML = `<section class="portal-live-order-detail">
        <div class="portal-live-order-heading"><div><p class="portal-eyebrow">Order #${escapeHTML(order.id.slice(0, 8).toUpperCase())}</p><h3>${escapeHTML(statusLabel(order.status))}</h3></div><strong>${money(order.total_ugx)}</strong></div>
        <p>Placed ${time(order.created_at)} · Payment ${escapeHTML(statusLabel(order.payment_status))} via ${escapeHTML(statusLabel(order.payment_method))}</p>
        <h4>Items</h4><ul class="portal-order-lines">${(items || []).map(item => `<li><span>${escapeHTML(item.product_name)} × ${Number(item.quantity)}${sellerView ? `<small>Primus commission (5%): ${money(item.primus_commission_ugx)}</small>` : ''}</span><strong>${money(item.line_total_ugx)}</strong></li>`).join('')}</ul>
        <h4>Delivery to</h4><p>${escapeHTML(order.recipient_name)} · ${escapeHTML(order.recipient_phone)}<br>${escapeHTML(order.address_line)}, ${escapeHTML(order.delivery_city)}${order.delivery_note ? `<br>Note: ${escapeHTML(order.delivery_note)}` : ''}</p>
        ${paymentRetry}
        ${canRequestReturn ? `<p class="portal-callout">Return requests must be submitted within 3 days of delivery. Primus commission is calculated on the original item value and is not reversed for returns.</p><p><a class="portal-action" href="${rootPath}pages/buyer-dashboard/refunds.html?order=${encodeURIComponent(order.id)}">Request a return or refund</a></p>` : ''}
        ${sellerView && ['preparing', 'assigned'].includes(order.status) ? `<div class="portal-live-actions">${order.status === 'preparing' ? '<button data-next-status="assigned">Accept order</button><button data-next-status="cancelled">Cancel order</button>' : `${order.rider_id ? '<button data-next-status="out_for_delivery">Mark out for delivery</button>' : '<p class="portal-callout">Awaiting a trusted rider assignment before delivery can start.</p>'}<button data-next-status="cancelled">Cancel order</button>`}</div>` : ''}
        <p id="orderDetailStatus" class="portal-form-message" role="status" aria-live="polite"></p>
        <a class="portal-card-link" href="${rootPath}pages/${sellerView ? 'seller-dashboard/orders.html' : 'buyer-dashboard/orders.html'}">Back to orders</a>
    </section>`;
    content.onclick = async event => {
        const button = event.target.closest('[data-next-status]');
        if (!button) return;
        button.disabled = true;
        const status = document.getElementById('orderDetailStatus');
        try {
            const { error } = await supabase.rpc('update_seller_order_status', {
                p_order_id: order.id,
                p_status: button.dataset.nextStatus
            });
            if (error) throw error;
            await renderOrderDetails();
        } catch (error) {
            console.error('Unable to update order status.', error);
            statusMessage(status, error.message, true);
            button.disabled = false;
        }
    };
}

function returnWorkflowError(error) {
    const code = error?.code || '';
    if (['PGRST202', 'PGRST204', '42P01', '42703'].includes(code)) {
        return 'Return and storefront tables are not ready. Run seller-storefront-returns-migration.sql in Supabase, then reload this page.';
    }
    return `Return requests could not be loaded: ${error?.message || 'network error'}`;
}

function returnRequestCard(request, buyerView) {
    const reason = { changed_mind: 'Changed my mind', wrong_item: 'Wrong item', faulty: 'Faulty item' }[request.reason] || statusLabel(request.reason);
    const shopLink = `${rootPath}pages/mini-shops/shop-page.html?seller=${encodeURIComponent(request.seller_id)}`;
    const refundLabel = request.status === 'requested' ? 'Estimated refund' : 'Refund amount';
    const refundMarkup = Number(request.refund_amount_ugx) > 0
        && ['requested', 'approved', 'refund_due', 'completed'].includes(request.status)
        ? `<p>${refundLabel}: <strong>${money(request.refund_amount_ugx)}</strong></p>`
        : '';
    return `<article class="portal-return-card" data-return-card="${escapeHTML(request.id)}">
        <div class="portal-return-heading"><div><p class="portal-eyebrow">Order #${escapeHTML(request.order_id.slice(0, 8).toUpperCase())} · ${time(request.created_at)}</p><h3>${escapeHTML(request.product_name)} × ${Number(request.quantity)}</h3></div><span class="portal-return-status">${escapeHTML(statusLabel(request.status))}</span></div>
        <p>${escapeHTML(reason)}${request.details ? ` · ${escapeHTML(request.details)}` : ''}</p>
        <p>Item value: <strong>${money(request.item_value_ugx)}</strong>${buyerView ? '' : ` · Primus commission (5%, retained): <strong>${money(request.commission_ugx)}</strong>`}</p>
        ${request.resolution === 'replacement' ? '<p>Resolution: replacement</p>' : refundMarkup}
        ${request.seller_response ? `<p>Shop response: ${escapeHTML(request.seller_response)}</p>` : ''}
        ${request.completion_reference ? `<p>Completion reference: ${escapeHTML(request.completion_reference)}</p>` : ''}
        ${!buyerView && request.automated_refund_status && request.automated_refund_status !== 'not_started' ? `<p>Flutterwave refund: ${escapeHTML(statusLabel(request.automated_refund_status))}${request.flutterwave_refund_reference ? ` · ${escapeHTML(request.flutterwave_refund_reference)}` : ''}${request.failure_message ? ` · ${escapeHTML(request.failure_message)}` : ''}</p>` : ''}
        ${!buyerView && ['processing', 'unknown'].includes(request.automated_refund_status) && !request.flutterwave_refund_id ? '<p class="form-note">The provider result is unknown. Reconcile it in Flutterwave before retrying or recording a manual payout.</p>' : ''}
        ${buyerView ? `<p><a class="portal-card-link" href="${shopLink}">View shop and return location</a></p>${request.status === 'requested' ? '<button type="button" data-return-action="cancel">Cancel request</button>' : ''}` : `<div class="portal-return-controls">
            ${request.status === 'requested' ? `${request.reason === 'changed_mind' ? '' : '<label>Resolution<select data-return-resolution><option value="refund">Full item refund</option><option value="replacement">Replacement</option></select></label>'}<label>Response to buyer<input type="text" data-return-response maxlength="1000" placeholder="Optional note"></label><button type="button" data-return-action="approve">Approve request</button><button type="button" data-return-action="reject">Reject request</button>` : ''}
            ${request.status === 'approved' ? `<label>Receipt note<input type="text" data-return-response maxlength="1000" placeholder="Optional condition / handover note"></label><button type="button" data-return-action="received">Confirm item received at shop</button>` : ''}
            ${request.status === 'replacement_due' ? `<label>Replacement delivery / handover reference<input type="text" data-return-reference maxlength="200" required></label><button type="button" data-return-action="replacement">Mark replacement completed</button>` : ''}
            ${request.status === 'refund_due' && currentRole === 'admin' && request.payment_method === 'mobile_money' && request.automated_refund_status === 'not_started' ? '<button type="button" data-return-action="flutterwave-refund">Start Flutterwave refund</button>' : ''}
            ${request.status === 'refund_due' && currentRole === 'admin' && request.payment_method === 'mobile_money' && ['pending', 'unknown'].includes(request.automated_refund_status) && request.flutterwave_refund_id ? '<button type="button" data-return-action="verify-flutterwave-refund">Check Flutterwave refund</button>' : ''}
            ${request.status === 'refund_due' && currentRole === 'admin' && (request.payment_method !== 'mobile_money' || request.automated_refund_status === 'failed') ? `<label>Refund payout reference<input type="text" data-return-reference maxlength="200" required placeholder="Payment reference or cash handover record"></label><button type="button" data-return-action="refund-paid">Record manual refund paid</button>` : ''}
        </div>`}
    </article>`;
}

async function renderBuyerReturnRequests() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: requests, error: requestError }, { data: orders, error: orderError }] = await Promise.all([
        supabase.from('return_requests')
            .select('id, order_id, order_item_id, seller_id, product_name, quantity, reason, details, item_value_ugx, refund_amount_ugx, resolution, status, seller_response, completion_reference, created_at')
            .eq('buyer_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100),
        supabase.from('orders')
            .select('id, delivered_at')
            .eq('buyer_id', currentUser.id)
            .eq('status', 'delivered')
            .gte('delivered_at', cutoff)
            .lte('delivered_at', now.toISOString())
            .order('delivered_at', { ascending: false })
    ]);
    if (requestError) throw requestError;
    if (orderError) throw orderError;
    const eligibleOrders = orders || [];
    const orderIds = eligibleOrders.map(order => order.id);
    let orderItems = [];
    if (orderIds.length) {
        const { data, error } = await supabase.from('order_items')
            .select('id, order_id, seller_id, product_name, unit_price_ugx, quantity')
            .in('order_id', orderIds)
            .order('created_at', { ascending: false });
        if (error) throw error;
        orderItems = data || [];
    }
    const reservedQuantity = new Map();
    for (const request of requests || []) {
        if (!['rejected', 'cancelled'].includes(request.status)) {
            reservedQuantity.set(request.order_item_id, (reservedQuantity.get(request.order_item_id) || 0) + Number(request.quantity));
        }
    }
    const requestedOrder = new URLSearchParams(window.location.search).get('order');
    const eligibleItems = orderItems
        .filter(item => !requestedOrder || item.order_id === requestedOrder)
        .map(item => ({ ...item, remaining: Number(item.quantity) - (reservedQuantity.get(item.id) || 0) }))
        .filter(item => item.remaining > 0);
    content.innerHTML = `<section class="portal-return-workflow">
        <div class="portal-return-policy"><h3>Return policy</h3><p>Request within 3 days after delivery, then bring the approved item to the seller's shop. Change-of-mind returns receive 75% of item value (delivery excluded). Wrong or faulty items qualify for a full item refund or replacement. Primus's 5% commission is based on the original item value and is not reversed.</p><p>Eligible paid Mobile Money refunds are processed through Flutterwave and require provider confirmation. Cash-on-delivery refunds are paid and recorded manually.</p></div>
        <form class="portal-form portal-return-form" id="returnRequestForm">
            <label class="form-field full-width">Delivered item<select name="order_item_id" id="returnOrderItem" required><option value="">Choose an eligible item</option>${eligibleItems.map(item => `<option value="${escapeHTML(item.id)}" data-order="${escapeHTML(item.order_id)}" data-seller="${escapeHTML(item.seller_id)}" data-price="${Number(item.unit_price_ugx)}" data-quantity="${item.remaining}">${escapeHTML(item.product_name)} · order #${escapeHTML(item.order_id.slice(0, 8).toUpperCase())} · ${item.remaining} returnable</option>`).join('')}</select></label>
            <label class="form-field">Quantity<input name="quantity" id="returnQuantity" type="number" min="1" value="1" required></label>
            <label class="form-field">Reason<select name="reason" id="returnReason" required><option value="changed_mind">Changed my mind</option><option value="wrong_item">Wrong item delivered</option><option value="faulty">Item is faulty</option></select></label>
            <label class="form-field full-width">Details<textarea name="details" id="returnDetails" maxlength="1000" rows="3" placeholder="Describe the issue, if applicable."></textarea></label>
            <p class="form-note full-width" id="returnQuote">Select an item to see the estimated refund.</p>
            <button type="submit" ${eligibleItems.length ? '' : 'disabled'}>Submit return request</button>
            <p class="portal-form-message full-width" id="returnFormStatus" role="status" aria-live="polite"></p>
        </form>
        ${eligibleItems.length ? '' : '<div class="portal-cart-empty"><h3>No delivered items are currently eligible</h3><p>Returns must be requested within 3 days of delivery. Use the link on an order details page to start a request for a specific order.</p></div>'}
        <h3 class="portal-section-title">Your return requests</h3>
        <div class="portal-return-list">${(requests || []).map(request => returnRequestCard(request, true)).join('') || '<div class="portal-cart-empty"><h3>No return requests yet</h3><p>Eligible delivered items will be available above.</p></div>'}</div>
    </section>`;

    const form = document.getElementById('returnRequestForm');
    const itemSelect = document.getElementById('returnOrderItem');
    const quantityInput = document.getElementById('returnQuantity');
    const reasonSelect = document.getElementById('returnReason');
    const detailsInput = document.getElementById('returnDetails');
    const quote = document.getElementById('returnQuote');
    const updateQuote = () => {
        const selected = itemSelect.selectedOptions[0];
        const item = eligibleItems.find(candidate => candidate.id === selected?.value);
        const shopLink = document.getElementById('returnShopLink');
        if (shopLink) shopLink.remove();
        const max = item?.remaining || 1;
        quantityInput.max = String(max);
        if (Number(quantityInput.value) > max) quantityInput.value = String(max);
        const isFaultyOrWrong = reasonSelect.value !== 'changed_mind';
        detailsInput.required = isFaultyOrWrong;
        if (!item) {
            quote.textContent = 'Select an item to see the estimated refund.';
            return;
        }
        const itemValue = Number(item.unit_price_ugx) * Math.max(1, Math.min(Number(quantityInput.value) || 1, max));
        quote.textContent = reasonSelect.value === 'changed_mind'
            ? `Estimated refund: ${money(Math.round(itemValue * 0.75))} (75% of item value; delivery excluded).`
            : 'For a wrong or faulty item, the seller will offer a full item refund or replacement after return.';
        const link = document.createElement('a');
        link.id = 'returnShopLink';
        link.className = 'portal-card-link';
        link.href = `${rootPath}pages/mini-shops/shop-page.html?seller=${encodeURIComponent(item.seller_id)}`;
        link.textContent = 'View seller shop and return location';
        quote.insertAdjacentElement('afterend', link);
    };
    itemSelect.addEventListener('change', updateQuote);
    quantityInput.addEventListener('input', updateQuote);
    reasonSelect.addEventListener('change', updateQuote);
    updateQuote();
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const { error } = await supabase.rpc('create_return_request', {
                p_order_item_id: itemSelect.value,
                p_quantity: Number(quantityInput.value),
                p_reason: reasonSelect.value,
                p_details: detailsInput.value.trim()
            });
            if (error) throw error;
            await renderBuyerReturnRequests();
        } catch (error) {
            console.error('Unable to submit the return request.', error);
            statusMessage(document.getElementById('returnFormStatus'), returnWorkflowError(error), true);
            button.disabled = false;
        }
    });
    content.onclick = async event => {
        const button = event.target.closest('[data-return-action="cancel"]');
        if (!button) return;
        const card = button.closest('[data-return-card]');
        button.disabled = true;
        try {
            const { error } = await supabase.rpc('cancel_return_request', { p_request_id: card.dataset.returnCard });
            if (error) throw error;
            await renderBuyerReturnRequests();
        } catch (error) {
            console.error('Unable to cancel the return request.', error);
            statusMessage(document.getElementById('returnFormStatus'), returnWorkflowError(error), true);
            button.disabled = false;
        }
    };
}

async function renderReturnManagement(adminView) {
    const request = supabase.from('return_requests')
        .select('id, order_id, seller_id, product_name, quantity, reason, details, item_value_ugx, commission_ugx, refund_amount_ugx, resolution, status, seller_response, completion_reference, created_at, automated_refund_status, flutterwave_refund_id, flutterwave_refund_reference, failure_message')
        .order('created_at', { ascending: false })
        .limit(100);
    if (!adminView) request.eq('seller_id', currentUser.id);
    const { data: requests, error } = await request;
    if (error) throw error;
    const orderIds = [...new Set((requests || []).map(requestItem => requestItem.order_id))];
    const { data: orders, error: orderError } = orderIds.length
        ? await supabase.from('orders').select('id, payment_method').in('id', orderIds)
        : { data: [], error: null };
    if (orderError) throw orderError;
    const paymentMethods = new Map((orders || []).map(order => [order.id, order.payment_method]));
    let section = document.getElementById('returnManagementSection');
    if (!section) {
        if (adminView) {
            content.innerHTML = '<section class="portal-return-workflow"><h2>Return management</h2><p class="portal-callout">Review item returns and confirm receipt. Flutterwave refunds are started and verified by the protected payment function; cash-on-delivery refunds remain manually recorded.</p><div id="returnManagementSection"></div></section>';
        } else {
            content.insertAdjacentHTML('beforeend', '<section class="portal-return-workflow" id="sellerReturnSection"><h2>Return requests</h2><p class="portal-callout">Confirm physical returns at your shop. The 5% Primus commission on the original item value remains payable.</p><div id="returnManagementSection"></div></section>');
        }
        section = document.getElementById('returnManagementSection');
    }
    section.innerHTML = (requests || []).map(requestItem => returnRequestCard({ ...requestItem, payment_method: paymentMethods.get(requestItem.order_id) }, false)).join('')
        || '<div class="portal-cart-empty"><h3>No return requests</h3><p>New buyer requests will appear here.</p></div>';
    section.onclick = async event => {
        const button = event.target.closest('[data-return-action]');
        if (!button) return;
        const card = button.closest('[data-return-card]');
        const requestId = card.dataset.returnCard;
        const action = button.dataset.returnAction;
        const response = card.querySelector('[data-return-response]')?.value.trim() || '';
        const reference = card.querySelector('[data-return-reference]')?.value.trim() || '';
        button.disabled = true;
        try {
            let result;
            if (action === 'approve' || action === 'reject') {
                result = await supabase.rpc('review_return_request', {
                    p_request_id: requestId,
                    p_decision: action,
                    p_resolution: card.querySelector('[data-return-resolution]')?.value || 'refund',
                    p_response: response
                });
            } else if (action === 'received') {
                result = await supabase.rpc('confirm_return_received', { p_request_id: requestId, p_note: response });
            } else if (action === 'replacement') {
                result = await supabase.rpc('complete_return_replacement', { p_request_id: requestId, p_reference: reference });
            } else if (action === 'refund-paid') {
                result = await supabase.rpc('confirm_return_refund_paid', { p_request_id: requestId, p_reference: reference });
            } else if (action === 'flutterwave-refund' || action === 'verify-flutterwave-refund') {
                result = await supabase.functions.invoke('flutterwave-payouts', {
                    body: { action: action === 'flutterwave-refund' ? 'refund' : 'verify_refund', id: requestId }
                });
            }
            if (result?.error) throw result.error;
            if (result?.data?.error) throw new Error(result.data.error);
            await renderReturnManagement(adminView);
        } catch (actionError) {
            console.error('Unable to update the return request.', actionError);
            const status = document.getElementById('returnManagerStatus');
            if (status) statusMessage(status, returnWorkflowError(actionError), true);
            else {
                const message = element('p', 'portal-form-message is-error', returnWorkflowError(actionError));
                section.prepend(message);
            }
            button.disabled = false;
        }
    };
}

async function initializeReturnRequests() {
    const buyerView = route === 'pages/buyer-dashboard/refunds.html' || route === 'pages/buyer-dashboard/returns.html';
    const sellerView = route === 'pages/seller-dashboard/orders.html' || route === 'pages/seller-dashboard/fulfilment.html';
    const adminView = route === 'pages/admin/refunds.html';
    if (!buyerView && !sellerView && !adminView) return;
    if (!currentUser) return signedOutPrompt('Return requests');
    try {
        if (buyerView) {
            await renderBuyerReturnRequests();
            return;
        }
        const profile = await requireRole(adminView ? 'admin' : null);
        if (!profile) return;
        if (adminView && currentRole !== 'admin') return;
        if (sellerView && !['seller', 'admin'].includes(currentRole)) {
            notice('Return management is available to approved sellers and the Primus administrator.', true);
            return;
        }
        await renderReturnManagement(adminView);
    } catch (error) {
        console.error('Unable to load return requests.', error);
        notice(returnWorkflowError(error), true);
    }
}

function currentCheckoutAddress() {
    try {
        const value = JSON.parse(sessionStorage.getItem('primus-checkout-address') || 'null');
        return value && typeof value === 'object' ? value : null;
    } catch (error) {
        console.error('Unable to read the checkout address.', error);
        return null;
    }
}

async function initializeWishlist() {
    if (route !== 'pages/buyer-dashboard/wishlist.html') return;

    const wishlist = readWishlist();
    const sampleProducts = Array.isArray(window.PRIMUS_PREVIEW_PRODUCTS)
        ? window.PRIMUS_PREVIEW_PRODUCTS
        : [];
    const previewProducts = sampleProducts
        .filter(product => wishlist.includes(product.id))
        .map(product => ({
            ...product,
            isPreview: true
        }));
    const databaseIds = wishlist.filter(id => uuidPattern.test(id));
    const liveProducts = databaseIds.length
        ? await loadProducts({ ids: databaseIds, limit: databaseIds.length })
        : [];
    const items = [...liveProducts.map(product => ({
        id: product.id,
        name: product.name,
        category: product.category,
        seller: product.seller_name,
        price: Number(product.price_ugx),
        stock: Number(product.stock),
        image: product.image_url,
        isPreview: false
    })), ...previewProducts];
    const availableIds = new Set(items.map(product => product.id));
    const missingIds = wishlist.filter(id => !availableIds.has(id));

    if (!wishlist.length) {
        content.innerHTML = '<div class="portal-cart-empty"><h3>Your wishlist is ready for good finds</h3><p>Save a product from the marketplace and it will appear here.</p><a class="portal-action" href="../../pages/marketplace/index.html">Explore products</a></div>';
        return;
    }

    content.innerHTML = `${missingIds.length ? `<div class="portal-callout">Some saved products are no longer available. Remove them to keep your wishlist up to date. <button type="button" id="removeUnavailableWishlist">Remove unavailable items</button></div>` : ''}
        ${items.length ? `<div class="portal-products">${items.map(product => `<article class="portal-product">
            <a href="${productPath(product)}"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy"></a>
            <div><small>${escapeHTML(product.category)} · ${escapeHTML(product.seller)}${product.isPreview ? ' · preview item' : ''}</small>
            <h3><a href="${productPath(product)}">${escapeHTML(product.name)}</a></h3>
            <p>${product.isPreview ? `UGX ${new Intl.NumberFormat('en-UG').format(product.price)}` : money(product.price)} <span>${product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</span></p>
            <div class="portal-live-actions"><button type="button" data-wishlist-add="${escapeHTML(product.id)}" ${product.stock <= 0 ? 'disabled' : ''}>Add to bag</button>
            <button type="button" data-wishlist-remove="${escapeHTML(product.id)}">Remove</button></div></div>
        </article>`).join('')}</div>` : '<div class="portal-cart-empty"><h3>Saved products are unavailable</h3><p>Remove unavailable items or browse the marketplace for new finds.</p></div>'}`;

    content.onclick = async event => {
        const removeButton = event.target.closest('[data-wishlist-remove]');
        if (removeButton) {
            saveWishlist(readWishlist().filter(id => id !== removeButton.dataset.wishlistRemove));
            await initializeWishlist();
            return;
        }
        const removeUnavailable = event.target.closest('#removeUnavailableWishlist');
        if (removeUnavailable) {
            saveWishlist(readWishlist().filter(id => availableIds.has(id)));
            await initializeWishlist();
            return;
        }
        const addButton = event.target.closest('[data-wishlist-add]');
        if (!addButton) return;
        const product = items.find(item => item.id === addButton.dataset.wishlistAdd);
        if (!product || product.stock <= 0) return;
        try {
            const cart = readCart();
            const existing = cart.find(item => item.id === product.id);
            if (existing && existing.quantity >= Math.min(product.stock, 99)) {
                statusMessage(document.getElementById('wishlistStatus'), 'You have added all available stock to your bag.', true);
                return;
            }
            if (existing) existing.quantity += 1;
            else cart.push({ id: product.id, quantity: 1 });
            saveCart(cart);
            statusMessage(document.getElementById('wishlistStatus'), `${product.name} added to your bag.`);
        } catch (error) {
            console.error('Unable to add a wishlist product to the bag.', error);
            statusMessage(document.getElementById('wishlistStatus'), error.message, true);
        }
    };
    content.insertAdjacentHTML('beforeend', '<p id="wishlistStatus" class="portal-form-message" role="status" aria-live="polite"></p>');
}

async function loadCartProducts(cart) {
    const ids = [...new Set(cart.map(item => item.id))];
    const databaseIds = ids.filter(id => uuidPattern.test(id));
    if (!databaseIds.length) return [];
    const { data, error } = await supabase
        .from('products')
        .select('id, seller_name, name, category, price_ugx, stock, image_url, is_published')
        .in('id', databaseIds);
    if (error) throw error;
    return data || [];
}

async function initializeCartAndCheckout() {
    const isCart = route === 'pages/cart/index.html';
    const isCheckout = route.startsWith('pages/checkout/');
    if (!isCart && !isCheckout) return;
    if (isCheckout && !currentUser) return signedOutPrompt('Checkout');
    if (route === 'pages/checkout/success.html') return renderOrderConfirmation();
    if (route === 'pages/checkout/processing.html') return renderFlutterwaveProcessing();
    if (route === 'pages/checkout/failed.html') {
        return notice('No payment has been confirmed on this page. Check your order details for its current status, or return to checkout to place another order.');
    }
    const cart = readCart();
    if (!cart.length) {
        content.innerHTML = '<div class="portal-cart-empty"><h3>Your bag is empty</h3><p>Add products from the marketplace to continue.</p><a class="portal-action" href="../../pages/marketplace/index.html">Browse products</a></div>';
        return;
    }
    const previewProducts = Array.isArray(window.PRIMUS_PREVIEW_PRODUCTS)
        ? window.PRIMUS_PREVIEW_PRODUCTS.map(product => ({
            ...product,
            seller_name: product.seller,
            price_ugx: Number(product.price),
            image_url: product.image,
            is_published: true,
            is_preview: true
        }))
        : [];
    const previewById = new Map(previewProducts.map(product => [product.id, product]));
    const previewCart = cart.filter(item => !uuidPattern.test(item.id));
    const liveCart = cart.filter(item => uuidPattern.test(item.id));
    const products = await loadCartProducts(liveCart);
    const byId = new Map([
        ...products.map(product => [product.id, product]),
        ...previewProducts.map(product => [product.id, product])
    ]);
    const unavailable = liveCart.filter(item => {
        const product = byId.get(item.id);
        return !product || !product.is_published || Number(product.stock) < item.quantity || Number(product.stock) <= 0;
    });
    const unavailablePreview = previewCart.filter(item => !previewById.has(item.id));

    if (isCheckout && (previewCart.length || unavailablePreview.length)) {
        content.innerHTML = `<div class="portal-cart-empty"><h3>Review your bag before checkout</h3>
            <p>Your bag contains preview or unavailable items. Remove them before continuing to checkout.</p>
            <a class="portal-action" href="${rootPath}pages/cart/index.html">Review bag</a></div>`;
        return;
    }

    if (route === 'pages/cart/index.html') {
        const itemsHTML = cart.map(item => {
            const product = byId.get(item.id);
            if (!product) {
                return `<article class="portal-cart-item" data-product-id="${escapeHTML(item.id)}">
                    <div><h3>Unavailable product</h3><p>This item is no longer available.</p></div>
                    <button type="button" data-cart-change="remove" data-product="${escapeHTML(item.id)}">Remove</button>
                </article>`;
            }
            const isPreview = Boolean(product.is_preview);
            const price = Number(product.price_ugx);
            const image = product.image_url || '';
            const name = product.name || 'Product';
            const seller = product.seller_name || 'Primus seller';
            return `<article class="portal-cart-item${isPreview ? ' is-preview-item' : ''}" data-product-id="${escapeHTML(item.id)}">
                <img src="${escapeHTML(image)}" alt="">
                <div><h3>${escapeHTML(name)}</h3><p>${money(price)} each · ${isPreview ? 'preview item, not purchasable' : escapeHTML(seller)}</p>
                    <div class="portal-cart-controls"><button type="button" data-cart-change="decrease" data-product="${escapeHTML(item.id)}" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-cart-change="increase" data-product="${escapeHTML(item.id)}" aria-label="Increase quantity"${item.quantity >= Math.min(Number(product.stock), 99) ? ' disabled' : ''}>+</button><button type="button" data-cart-change="remove" data-product="${escapeHTML(item.id)}">Remove</button></div>
                </div></article>`;
        }).join('');
        const subtotal = liveCart.reduce((sum, item) => {
            const product = byId.get(item.id);
            return sum + (product && product.is_published ? Number(product.price_ugx) * item.quantity : 0);
        }, 0);
        const canCheckout = liveCart.length > 0 && !previewCart.length && !unavailable.length;
        content.innerHTML = `${unavailable.length || unavailablePreview.length ? `<div class="portal-callout is-error"><p>Some products are unavailable. Remove them before checkout.</p><button type="button" id="removeUnavailableProducts">Remove unavailable items</button></div>` : ''}
            ${previewCart.length ? '<p class="portal-callout">Preview items are for layout testing only. They are not real listings and cannot be purchased.</p>' : ''}
            <div class="portal-cart">${itemsHTML}</div>
            <div class="portal-cart-summary"><span>Subtotal for live products</span><strong>${money(subtotal)}</strong><p>Delivery fees are not charged in this MVP.</p>
                ${canCheckout ? `<a class="portal-action" href="${rootPath}pages/checkout/address.html">Continue to delivery address</a>` : '<button type="button" disabled>Checkout unavailable</button>'}
                ${!canCheckout && !previewCart.length && !unavailable.length && !unavailablePreview.length ? '<p>Add a live product to continue.</p>' : ''}
            </div>`;
        const removeUnavailableButton = document.getElementById('removeUnavailableProducts');
        if (removeUnavailableButton) {
            removeUnavailableButton.addEventListener('click', () => {
                const unavailableIds = new Set([...unavailable, ...unavailablePreview].map(item => item.id));
                saveCart(readCart().filter(item => !unavailableIds.has(item.id)));
                void initializeCartAndCheckout();
            });
        }
        content.onclick = event => {
            const button = event.target.closest('[data-cart-change]');
            if (!button) return;
            const product = byId.get(button.dataset.product);
            const updated = readCart().map(item => {
                if (item.id !== button.dataset.product) return item;
                if (button.dataset.cartChange === 'increase' && product) {
                    if (item.quantity >= Math.min(Number(product.stock), 99)) return item;
                    return { ...item, quantity: Math.min(item.quantity + 1, Number(product.stock), 99) };
                }
                if (button.dataset.cartChange === 'decrease' && item.quantity > 1) {
                    return { ...item, quantity: item.quantity - 1 };
                }
                return item;
            }).filter(item => item.id !== button.dataset.product || button.dataset.cartChange !== 'remove');
            saveCart(updated);
            void initializeCartAndCheckout();
        };
        return;
    }

    if (unavailable.length) {
        content.innerHTML = `<div class="portal-cart-empty"><h3>Some products in your bag are unavailable</h3>
            <p>Remove these items to continue with available published listings.</p>
            <ul>${unavailable.map(item => `<li>Product ${escapeHTML(item.id)} · quantity ${item.quantity}</li>`).join('')}</ul>
            <button type="button" id="removeUnavailableProducts">Remove unavailable items</button></div>`;
        document.getElementById('removeUnavailableProducts').addEventListener('click', () => {
            const unavailableIds = new Set(unavailable.map(item => item.id));
            saveCart(cart.filter(item => !unavailableIds.has(item.id)));
            void initializeCartAndCheckout();
        });
        return;
    }
    if (route === 'pages/checkout/address.html') return renderAddressForm();
    if (route === 'pages/checkout/payment.html') return renderPaymentPage(products, cart);
    if (route === 'pages/checkout/delivery.html') {
        content.innerHTML = `<p class="portal-callout">Delivery arrangements are confirmed with the seller. Delivery fees are not calculated by Primus yet.</p><a class="portal-action" href="../../pages/checkout/payment.html">Continue to payment</a>`;
        return;
    }
    const subtotal = cart.reduce((sum, item) => sum + Number(byId.get(item.id).price_ugx) * item.quantity, 0);
    const itemsHTML = cart.map(item => {
        const product = byId.get(item.id);
        return `<article class="portal-cart-item"><img src="${escapeHTML(product.image_url)}" alt=""><div><h3>${escapeHTML(product.name)}</h3><p>${money(product.price_ugx)} each</p><div class="portal-cart-controls"><button type="button" data-cart-change="decrease" data-product="${escapeHTML(product.id)}" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-cart-change="increase" data-product="${escapeHTML(product.id)}" aria-label="Increase quantity">+</button><button type="button" data-cart-change="remove" data-product="${escapeHTML(product.id)}">Remove</button></div></div></article>`;
    }).join('');
    content.innerHTML = `<div class="portal-cart">${itemsHTML}</div><div class="portal-cart-summary"><span>Subtotal</span><strong>${money(subtotal)}</strong><p>Delivery fees are not charged in this MVP.</p><a class="portal-action" href="../../pages/checkout/address.html">Continue to delivery address</a></div>`;
    content.onclick = event => {
        const button = event.target.closest('[data-cart-change]');
        if (!button) return;
        const product = byId.get(button.dataset.product);
        const updated = readCart().map(item => {
            if (item.id !== button.dataset.product) return item;
            if (button.dataset.cartChange === 'increase') return { ...item, quantity: Math.min(item.quantity + 1, Number(product.stock), 99) };
            if (button.dataset.cartChange === 'decrease' && item.quantity > 1) return { ...item, quantity: item.quantity - 1 };
            return item;
        }).filter(item => item.id !== button.dataset.product || button.dataset.cartChange !== 'remove');
        saveCart(updated);
        void initializeCartAndCheckout();
    };
}

async function renderAddressForm() {
    const savedAddress = currentCheckoutAddress() || {};
    let storedAddresses = [];
    const { data, error } = await supabase
        .from('buyer_addresses')
        .select('id, label, recipient_name, phone, address_line, city, delivery_note, is_default')
        .eq('user_id', currentUser.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) throw error;
    storedAddresses = data || [];
    content.innerHTML = `<form class="portal-form portal-checkout-form" id="checkoutAddressForm">
        ${storedAddresses.length ? `<label class="form-field full-width">Use a saved address<select id="savedAddressSelect"><option value="">Enter a new address</option>${storedAddresses.map(address => `<option value="${escapeHTML(address.id)}">${escapeHTML(address.label)} · ${escapeHTML(address.address_line)}</option>`).join('')}</select></label>` : ''}
        <label class="form-field">Recipient name<input name="recipient_name" type="text" maxlength="120" required value="${escapeHTML(savedAddress.recipient_name || '')}"></label>
        <label class="form-field">Phone number<input name="recipient_phone" type="tel" maxlength="40" required value="${escapeHTML(savedAddress.recipient_phone || '')}"></label>
        <label class="form-field full-width">Delivery address<input name="address_line" type="text" maxlength="300" required value="${escapeHTML(savedAddress.address_line || '')}"></label>
        <label class="form-field">City or area<input name="delivery_city" type="text" maxlength="100" required value="${escapeHTML(savedAddress.delivery_city || '')}"></label>
        <label class="form-field full-width">Delivery note (optional)<textarea name="delivery_note" maxlength="500">${escapeHTML(savedAddress.delivery_note || '')}</textarea></label>
        <label class="check-filter full-width"><input name="save_address" type="checkbox"><span>Save this address to my account</span></label>
        <p class="form-note full-width">This address is shared with the sellers fulfilling the order.</p>
        <button type="submit">Continue to payment</button><p id="checkoutAddressStatus" class="portal-form-message" role="status" aria-live="polite"></p>
    </form>`;
    const addressSelect = document.getElementById('savedAddressSelect');
    addressSelect?.addEventListener('change', () => {
        const address = storedAddresses.find(item => item.id === addressSelect.value);
        if (!address) return;
        for (const [field, key] of [['recipient_name', 'recipient_name'], ['recipient_phone', 'phone'], ['address_line', 'address_line'], ['delivery_city', 'city'], ['delivery_note', 'delivery_note']]) {
            content.querySelector(`[name="${field}"]`).value = address[key] || '';
        }
    });
    document.getElementById('checkoutAddressForm').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const status = document.getElementById('checkoutAddressStatus');
        button.disabled = true;
        const values = new FormData(form);
        const address = {
            recipient_name: String(values.get('recipient_name')).trim(),
            recipient_phone: String(values.get('recipient_phone')).trim(),
            address_line: String(values.get('address_line')).trim(),
            delivery_city: String(values.get('delivery_city')).trim(),
            delivery_note: String(values.get('delivery_note') || '').trim()
        };
        try {
            sessionStorage.setItem('primus-checkout-address', JSON.stringify(address));
            if (values.get('save_address') === 'on' && !addressSelect?.value) {
                const { error: saveError } = await supabase.from('buyer_addresses').insert({
                    user_id: currentUser.id,
                    label: address.delivery_city.slice(0, 40),
                    recipient_name: address.recipient_name,
                    phone: address.recipient_phone,
                    address_line: address.address_line,
                    city: address.delivery_city,
                    delivery_note: address.delivery_note
                });
                if (saveError) throw saveError;
            }
            window.location.href = `${rootPath}pages/checkout/payment.html`;
        } catch (error) {
            console.error('Unable to save the checkout address.', error);
            statusMessage(status, error.message, true);
            button.disabled = false;
        }
    });
}

function renderPaymentPage(products, cart) {
    const address = currentCheckoutAddress();
    if (!address) {
        content.innerHTML = '<p class="portal-callout">Add a delivery address before choosing payment.</p><a class="portal-action" href="../../pages/checkout/address.html">Add delivery address</a>';
        return;
    }
    const total = cart.reduce((sum, item) => sum + Number(products.find(product => product.id === item.id).price_ugx) * item.quantity, 0);
    content.innerHTML = `<section class="portal-checkout-review"><h3>Review your order</h3><p>${escapeHTML(address.recipient_name)} · ${escapeHTML(address.recipient_phone)}</p><p>${escapeHTML(address.address_line)}, ${escapeHTML(address.delivery_city)}</p><ul class="portal-order-lines">${cart.map(item => {
        const product = products.find(candidate => candidate.id === item.id);
        return `<li><span>${escapeHTML(product.name)} × ${item.quantity}</span><strong>${money(Number(product.price_ugx) * item.quantity)}</strong></li>`;
    }).join('')}</ul><div class="portal-checkout-total"><span>Total</span><strong>${money(total)}</strong></div>
        <fieldset class="portal-payment-options"><legend>Payment method</legend>
            <label><input type="radio" name="payment-method" value="cash_on_delivery" checked><span><strong>Cash on delivery</strong><small>Pay your seller when the order arrives.</small></span></label>
            <label><input type="radio" name="payment-method" value="mobile_money"><span><strong>Mobile Money</strong><small>Pay securely with MTN or Airtel Uganda via Flutterwave.</small></span></label>
        </fieldset>
        <div class="portal-mobile-money-fields" id="mobileMoneyFields" hidden>
            <label class="form-field">Network<select id="mobileMoneyNetwork"><option value="MTN">MTN Uganda</option><option value="AIRTEL">Airtel Uganda</option></select></label>
            <label class="form-field">Payment phone number<input id="mobileMoneyPhone" type="tel" autocomplete="tel" maxlength="20" required value="${escapeHTML(address.recipient_phone)}"></label>
            <p class="form-note">A payment prompt will be sent to this number. Your order is not confirmed until the payment is verified.</p>
        </div>
        <button class="portal-action" id="placeOrderButton" type="button">Place cash-on-delivery order</button>
        <p id="placeOrderStatus" class="portal-form-message" role="status" aria-live="polite"></p>
    </section>`;
    const mobileMoneyFields = document.getElementById('mobileMoneyFields');
    const paymentChoices = [...content.querySelectorAll('input[name="payment-method"]')];
    const orderButton = document.getElementById('placeOrderButton');
    const updatePaymentChoice = () => {
        const mobileMoneySelected = content.querySelector('input[name="payment-method"]:checked').value === 'mobile_money';
        mobileMoneyFields.hidden = !mobileMoneySelected;
        orderButton.textContent = mobileMoneySelected ? 'Continue to Mobile Money' : 'Place cash-on-delivery order';
    };
    paymentChoices.forEach(choice => choice.addEventListener('change', updatePaymentChoice));
    document.getElementById('placeOrderButton').addEventListener('click', async event => {
        const button = event.currentTarget;
        const status = document.getElementById('placeOrderStatus');
        const paymentMethod = content.querySelector('input[name="payment-method"]:checked').value;
        const network = document.getElementById('mobileMoneyNetwork').value;
        const phoneNumber = document.getElementById('mobileMoneyPhone').value.trim();
        if (paymentMethod === 'mobile_money' && !document.getElementById('mobileMoneyPhone').reportValidity()) return;
        button.disabled = true;
        statusMessage(status, paymentMethod === 'mobile_money' ? 'Reserving your items securely…' : 'Checking stock and creating your order…');
        try {
            const { data, error } = await supabase.rpc('create_marketplace_order', {
                p_items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
                p_shipping: address,
                p_payment_method: paymentMethod
            });
            if (error) throw error;
            if (!data || !data.length) throw new Error('No order was returned. Please try again.');
            saveCart([]);
            sessionStorage.removeItem('primus-checkout-address');
            if (paymentMethod === 'mobile_money') {
                const txRef = data[0].provider_reference;
                if (!txRef || !/^primus-[0-9a-f-]{36}$/i.test(txRef)) {
                    throw new Error('The order was reserved, but no payment reference was returned. Contact support before placing another order.');
                }
                sessionStorage.setItem(`primus-payment-${txRef}`, JSON.stringify({
                    network,
                    phone_number: phoneNumber,
                    fullname: address.recipient_name,
                    order_ids: data.map(order => order.order_id)
                }));
                window.location.href = `${rootPath}pages/checkout/processing.html?tx_ref=${encodeURIComponent(txRef)}`;
                return;
            }
            const ids = data.map(order => order.order_id).join(',');
            window.location.href = `${rootPath}pages/checkout/success.html?orders=${encodeURIComponent(ids)}`;
        } catch (error) {
            console.error('Unable to place marketplace order.', error);
            statusMessage(status, error.message || 'The order could not be placed.', true);
            button.disabled = false;
        }
    });
}

async function renderFlutterwaveProcessing() {
    const txRef = new URLSearchParams(window.location.search).get('tx_ref') || '';
    if (!/^primus-[0-9a-f-]{36}$/i.test(txRef)) {
        return notice('This payment reference is invalid. Check your orders or contact support.', true);
    }
    let payment;
    try {
        payment = JSON.parse(sessionStorage.getItem(`primus-payment-${txRef}`) || 'null');
    } catch (error) {
        console.error('Unable to read the pending payment details.', error);
        payment = null;
    }
    if (!payment || typeof payment !== 'object') payment = {};

    content.innerHTML = `<section class="portal-checkout-review portal-payment-progress">
        <h3>Complete your Mobile Money payment</h3>
        <p id="mobileMoneyStatus" role="status" aria-live="polite">Starting your secure payment…</p>
        <div class="portal-live-actions">
            <button type="button" id="retryMobileMoney">Start payment</button>
            <button type="button" id="verifyMobileMoney" ${payment.network && payment.phone_number && payment.fullname ? 'disabled' : ''}>I've approved it — check status</button>
        </div>
        <p class="form-note">Approve the prompt on your phone. Do not retry if you have already approved it; check the status instead.</p>
    </section>`;
    const status = document.getElementById('mobileMoneyStatus');
    const startButton = document.getElementById('retryMobileMoney');
    const verifyButton = document.getElementById('verifyMobileMoney');
    const canStart = Boolean(payment.network && payment.phone_number && payment.fullname);
    startButton.hidden = !canStart;
    const invokePayment = async action => {
        const payload = { action, tx_ref: txRef };
        if (action === 'initiate') Object.assign(payload, {
            network: payment.network,
            phone_number: payment.phone_number,
            fullname: payment.fullname
        });
        const { data, error } = await supabase.functions.invoke('flutterwave-payment', { body: payload });
        if (error) {
            const response = error.context;
            if (response instanceof Response) {
                let details;
                try {
                    details = await response.clone().json();
                } catch (parseError) {
                    console.error('Unable to read the payment service error details.', parseError);
                }
                if (typeof details?.error === 'string') throw new Error(details.error);
            }
            throw error;
        }
        if (!data || data.error) throw new Error(data?.error || 'The payment service returned no status.');
        return data;
    };

    const checkPayment = async () => {
        verifyButton.disabled = true;
        statusMessage(status, 'Checking Flutterwave for a verified payment…');
        try {
            const result = await invokePayment('verify');
            if (result.status === 'paid') {
                sessionStorage.removeItem(`primus-payment-${txRef}`);
                const ids = (result.order_ids || payment.order_ids || []).join(',');
                window.location.href = `${rootPath}pages/checkout/success.html?orders=${encodeURIComponent(ids)}`;
                return;
            }
            if (result.status === 'failed') {
                statusMessage(status, result.message || 'The payment was not completed. Your items have been released.', true);
                startButton.disabled = true;
                return;
            }
            if (result.status === 'unknown') {
                statusMessage(status, result.message || 'Payment status is unclear. Do not retry; contact support with your reference.', true);
                startButton.disabled = true;
                return;
            }
            verifyButton.disabled = false;
            statusMessage(status, result.message || 'Payment is still processing. Approve the prompt on your phone, then check again.');
        } catch (error) {
            console.error('Unable to verify the Mobile Money payment.', error);
            statusMessage(status, error.message || 'Payment status could not be checked. Try again shortly.', true);
            verifyButton.disabled = false;
        }
    };

    const startPayment = async () => {
        startButton.disabled = true;
        statusMessage(status, 'Requesting a Mobile Money prompt…');
        try {
            const result = await invokePayment('initiate');
            if (result.status === 'paid') {
                sessionStorage.removeItem(`primus-payment-${txRef}`);
                const ids = (result.order_ids || payment.order_ids || []).join(',');
                window.location.href = `${rootPath}pages/checkout/success.html?orders=${encodeURIComponent(ids)}`;
                return;
            }
            if (result.status === 'failed') {
                statusMessage(status, result.message || 'The payment could not be started.', true);
                startButton.disabled = true;
                return;
            }
            if (result.status === 'unknown') {
                statusMessage(status, result.message || 'Payment status is unclear. Do not retry; contact support with your reference.', true);
                startButton.disabled = true;
                return;
            }
            verifyButton.disabled = false;
            statusMessage(status, 'Approve the payment prompt on your phone. Once approved, check the payment status here.');
        } catch (error) {
            console.error('Unable to start the Mobile Money payment.', error);
            statusMessage(status, error.message || 'The payment could not be started. Do not place the order again; retry here or contact support.', true);
            startButton.disabled = false;
        }
    };

    startButton.addEventListener('click', () => { void startPayment(); });
    verifyButton.addEventListener('click', () => { void checkPayment(); });
    if (canStart) {
        void startPayment();
    } else {
        statusMessage(status, 'Payment details are unavailable. You can check whether Flutterwave confirmed it, but do not start a new charge from this page.');
    }
}

async function renderOrderConfirmation() {
    const orderIds = (new URLSearchParams(window.location.search).get('orders') || '').split(',').filter(id => uuidPattern.test(id));
    if (!orderIds.length) {
        content.innerHTML = '<div class="portal-cart-empty"><h3>No completed order was found</h3><p>Your bag may still be available if checkout did not finish.</p><a class="portal-action" href="../../pages/buyer-dashboard/orders.html">View my orders</a></div>';
        return;
    }
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, payment_method, payment_status')
        .eq('buyer_id', currentUser.id)
        .in('id', orderIds);
    if (error) throw error;
    const allPaid = orders?.length === orderIds.length && orders.every(order => order.payment_status === 'paid');
    content.innerHTML = `<div class="portal-cart-empty"><h3>Order placed</h3><p>${allPaid ? 'Your Mobile Money payment is confirmed.' : 'Your seller has been notified. Payment is due on delivery.'}</p>${orderIds.map(id => `<a class="portal-card-link" href="${rootPath}pages/buyer-dashboard/order-details.html?order=${encodeURIComponent(id)}">View order #${escapeHTML(id.slice(0, 8).toUpperCase())}</a>`).join('<br>')}<p><a class="portal-action" href="${rootPath}pages/buyer-dashboard/orders.html">Go to my orders</a></p></div>`;
}

async function initializeNotifications() {
    if (route !== 'pages/notifications/index.html' && route !== 'pages/buyer-dashboard/notifications.html') return;
    if (!currentUser) return signedOutPrompt('Notifications');
    const status = element('p', 'portal-form-message');
    status.textContent = 'Loading notifications…';
    content.replaceChildren(status);
    const render = async () => {
        const { data, error } = await supabase
            .from('notifications')
            .select('id, order_id, conversation_id, kind, title, body, created_at, read_at')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        const notifications = data || [];
        content.innerHTML = `<div class="portal-live-toolbar"><p>${notifications.filter(item => !item.read_at).length} unread</p><button type="button" id="markAllNotificationsRead" ${notifications.some(item => !item.read_at) ? '' : 'disabled'}>Mark all as read</button></div>
            <div class="portal-notifications">${notifications.map(item => `<article class="portal-notification${item.read_at ? '' : ' is-unread'}">
                <div><p class="portal-eyebrow">${escapeHTML(item.kind.replace(/_/g, ' '))} · ${time(item.created_at)}</p><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.body)}</p>${item.order_id ? `<a href="${rootPath}pages/buyer-dashboard/order-details.html?order=${encodeURIComponent(item.order_id)}">Open order</a>` : item.conversation_id ? `<a href="${rootPath}pages/messages/conversation.html?conversation=${encodeURIComponent(item.conversation_id)}">Open conversation</a>` : ''}</div>
                ${item.read_at ? '' : `<button type="button" data-read-notification="${escapeHTML(item.id)}">Mark read</button>`}
            </article>`).join('') || '<div class="portal-cart-empty"><h3>You are all caught up</h3><p>Order and message updates will appear here.</p></div>'}</div>`;
        content.onclick = async event => {
            const single = event.target.closest('[data-read-notification]');
            const all = event.target.closest('#markAllNotificationsRead');
            if (!single && !all) return;
            const ids = single ? [single.dataset.readNotification] : notifications.filter(item => !item.read_at).map(item => item.id);
            const button = single || all;
            button.disabled = true;
            try {
                const { error: updateError } = await supabase
                    .from('notifications')
                    .update({ read_at: new Date().toISOString() })
                    .eq('user_id', currentUser.id)
                    .in('id', ids);
                if (updateError) throw updateError;
                await render();
            } catch (updateError) {
                console.error('Unable to mark notifications as read.', updateError);
                button.disabled = false;
                statusMessage(status, updateError.message, true);
            }
        };
    };
    try {
        await render();
        notificationChannel = supabase
            .channel(`primus-notifications:${currentUser.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${currentUser.id}`
            }, () => { void render(); })
            .subscribe(channelStatus => {
                if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
                    console.error('Notification realtime subscription failed:', channelStatus);
                }
            });
        window.addEventListener('pagehide', () => {
            if (notificationChannel) void supabase.removeChannel(notificationChannel);
        }, { once: true });
    } catch (error) {
        console.error('Unable to load notifications.', error);
        notice(`Notifications could not be loaded: ${error.message}`, true);
    }
}

async function initializeAdminApplications() {
    const sellerRoute = route === 'pages/admin/seller-applications.html';
    const riderRoute = route === 'pages/admin/rider-applications.html';
    if (!sellerRoute && !riderRoute) return;
    const profile = await requireRole('admin');
    if (!profile) return;

    const refresh = async () => {
        content.innerHTML = '<p class="portal-callout">Loading applications…</p>';
        if (sellerRoute) {
            const { data: shops, error: shopError } = await supabase
                .from('seller_shops')
                .select('seller_id, shop_name, contact_phone, district, city, area, address, terms_accepted_at')
                .not('terms_accepted_at', 'is', null)
                .order('updated_at', { ascending: false });
            if (shopError) throw shopError;
            const sellerIds = (shops || []).map(shop => shop.seller_id);
            const { data: profiles, error: profileError } = sellerIds.length
                ? await supabase.from('profiles').select('id, display_name, role').in('id', sellerIds)
                : { data: [], error: null };
            if (profileError) throw profileError;
            const pending = new Map((profiles || []).filter(item => item.role === 'buyer').map(item => [item.id, item]));
            const applications = (shops || []).filter(shop => pending.has(shop.seller_id));
            content.innerHTML = `<p class="portal-callout">Approve only complete applications with accepted seller terms. The shop address and phone become public when its owner publishes the storefront.</p>
                ${applications.length ? `<div class="portal-admin-application-list">${applications.map(shop => {
                    const applicant = pending.get(shop.seller_id);
                    return `<article class="portal-card"><h3>${escapeHTML(shop.shop_name)}</h3>
                        <p><strong>Applicant</strong> ${escapeHTML(applicant.display_name || 'Name not provided')}</p>
                        <p><strong>Contact</strong> ${escapeHTML(shop.contact_phone)}</p>
                        <p><strong>Location</strong> ${escapeHTML([shop.area, shop.city, shop.district].filter(Boolean).join(', '))}</p>
                        <p><strong>Address</strong> ${escapeHTML(shop.address)}</p>
                        <p><strong>Terms accepted</strong> ${escapeHTML(time(shop.terms_accepted_at))}</p>
                        <button type="button" data-approve-seller="${escapeHTML(shop.seller_id)}">Approve seller</button></article>`;
                }).join('')}</div>` : '<div class="portal-cart-empty"><h3>No seller applications are waiting</h3><p>Complete seller applications will appear here.</p></div>'}
                <p class="portal-form-message" id="adminApplicationStatus" role="status" aria-live="polite"></p>`;
            return;
        }

        const { data: applications, error: applicationError } = await supabase
            .from('rider_applications')
            .select('user_id, submitted_at')
            .eq('status', 'pending')
            .order('submitted_at', { ascending: true });
        if (applicationError) throw applicationError;
        const riderIds = (applications || []).map(application => application.user_id);
        const { data: applicants, error: applicantError } = riderIds.length
            ? await supabase.from('profiles').select('id, display_name, phone_number').in('id', riderIds)
            : { data: [], error: null };
        if (applicantError) throw applicantError;
        const applicantById = new Map((applicants || []).map(applicant => [applicant.id, applicant]));
        content.innerHTML = `<p class="portal-callout">Approving an application assigns the rider role. Rejections leave the account as a buyer.</p>
            ${(applications || []).length ? `<div class="portal-admin-application-list">${applications.map(application => {
                const applicant = applicantById.get(application.user_id);
                return `<article class="portal-card"><h3>${escapeHTML(applicant?.display_name || 'Rider applicant')}</h3>
                    <p><strong>Phone</strong> ${escapeHTML(applicant?.phone_number || 'Not provided')}</p>
                    <p><strong>Applied</strong> ${escapeHTML(time(application.submitted_at))}</p>
                    <button type="button" data-review-rider="${escapeHTML(application.user_id)}" data-decision="approve">Approve rider</button>
                    <button type="button" data-review-rider="${escapeHTML(application.user_id)}" data-decision="reject" class="portal-secondary-button">Reject</button></article>`;
            }).join('')}</div>` : '<div class="portal-cart-empty"><h3>No rider applications are waiting</h3><p>Pending rider applications will appear here.</p></div>'}
            <p class="portal-form-message" id="adminApplicationStatus" role="status" aria-live="polite"></p>`;
    };

    content.addEventListener('click', async event => {
        const button = event.target.closest('[data-approve-seller], [data-review-rider]');
        if (!button || button.disabled) return;
        button.disabled = true;
        const status = document.getElementById('adminApplicationStatus');
        try {
            const result = button.dataset.approveSeller
                ? await supabase.rpc('admin_approve_seller', { p_seller_id: button.dataset.approveSeller })
                : await supabase.rpc('admin_review_rider_application', {
                    p_user_id: button.dataset.reviewRider,
                    p_decision: button.dataset.decision
                });
            if (result.error) throw result.error;
            statusMessage(status, 'Application updated.');
            await refresh();
        } catch (error) {
            console.error('Unable to update the application.', error);
            statusMessage(status, `Application update failed: ${error.message}`, true);
            button.disabled = false;
        }
    });

    await refresh();
}

async function initializeAdminDeliveryAssignment() {
    if (route !== 'pages/admin/deliveries.html') return;
    const profile = await requireRole('admin');
    if (!profile) return;

    const refresh = async () => {
        content.innerHTML = '<p class="portal-callout">Loading delivery assignments…</p>';
        const [{ data: orders, error: orderError }, { data: approvedApplications, error: riderApplicationError }] = await Promise.all([
            supabase.from('orders')
                .select('id, status, payment_method, payment_status, delivery_city, recipient_name, created_at, rider_id')
                .in('status', ['preparing', 'assigned'])
                .order('created_at', { ascending: true }),
            supabase.from('rider_applications').select('user_id').eq('status', 'approved')
        ]);
        if (orderError) throw orderError;
        if (riderApplicationError) throw riderApplicationError;
        const approvedIds = (approvedApplications || []).map(application => application.user_id);
        const { data: riders, error: riderError } = approvedIds.length
            ? await supabase.from('profiles').select('id, display_name, phone_number').in('id', approvedIds).eq('role', 'rider')
            : { data: [], error: null };
        if (riderError) throw riderError;
        const riderOptions = (riders || []).map(rider => `<option value="${escapeHTML(rider.id)}">${escapeHTML(rider.display_name || 'Rider')} · ${escapeHTML(rider.phone_number || 'No phone')}</option>`).join('');
        content.innerHTML = `<p class="portal-callout">Only approved riders can be assigned. Mobile Money orders must be paid before they can be assigned.</p>
            ${(orders || []).length ? `<div class="portal-admin-application-list">${orders.map(order => {
                const paymentReady = order.payment_method !== 'mobile_money' || order.payment_status === 'paid';
                return `<article class="portal-card"><h3>Order ${escapeHTML(order.id.slice(0, 8).toUpperCase())}</h3>
                    <p><strong>Recipient</strong> ${escapeHTML(order.recipient_name || 'Not provided')} · ${escapeHTML(order.delivery_city || 'Location not set')}</p>
                    <p><strong>Status</strong> ${escapeHTML(order.status)} · ${escapeHTML(order.payment_method === 'mobile_money' ? order.payment_status : 'cash on delivery')}</p>
                    ${paymentReady && riders?.length ? `<form data-admin-assignment data-order-id="${escapeHTML(order.id)}">
                        <label class="form-field">Approved rider<select name="rider_id" required><option value="">Choose rider</option>${riderOptions}</select></label>
                        <button type="submit">Assign rider</button><p class="portal-form-message" role="status" aria-live="polite"></p>
                    </form>` : `<p class="form-note">${paymentReady ? 'Approve a rider before assigning deliveries.' : 'Payment must be verified before rider assignment.'}</p>`}</article>`;
            }).join('')}</div>` : '<div class="portal-cart-empty"><h3>No orders need a rider</h3><p>Orders preparing or ready for delivery will appear here.</p></div>'}
            <p class="portal-form-message" id="adminAssignmentStatus" role="status" aria-live="polite"></p>`;
    };

    content.addEventListener('submit', async event => {
        const form = event.target.closest('[data-admin-assignment]');
        if (!form) return;
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const status = form.querySelector('[role="status"]');
        button.disabled = true;
        try {
            const { error } = await supabase.rpc('admin_assign_order_rider', {
                p_order_id: form.dataset.orderId,
                p_rider_id: form.elements.rider_id.value
            });
            if (error) throw error;
            statusMessage(status, 'Rider assigned.');
            await refresh();
        } catch (error) {
            console.error('Unable to assign the rider.', error);
            statusMessage(status, `Rider assignment failed: ${error.message}`, true);
            button.disabled = false;
        }
    });

    await refresh();
}

async function initializeSellerSettlements() {
    if (route !== 'pages/seller-dashboard/settlements.html') return;
    const profile = await requireRole('seller');
    if (!profile) return;

    const [{ data: destination, error: destinationError }, { data: settlements, error: settlementError }] = await Promise.all([
        supabase.from('seller_payout_destinations')
            .select('beneficiary_name, network, phone_number, terms_accepted_at, verified_at, updated_at')
            .eq('seller_id', currentUser.id)
            .maybeSingle(),
        supabase.from('seller_settlements')
            .select('id, order_id, gross_ugx, commission_ugx, refunds_ugx, amount_ugx, status, transfer_reference, failure_message, created_at, paid_at')
            .eq('seller_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100)
    ]);
    if (destinationError) throw destinationError;
    if (settlementError) throw settlementError;

    content.innerHTML = `<section class="portal-return-workflow">
        <h2>Flutterwave payout details</h2>
        <p class="portal-callout">Set an MTN or Airtel Uganda Mobile Money destination. Primus verifies the details before an administrator can send a settlement. Your payout details are private to you and authorized administrators.</p>
        <form class="portal-form" id="sellerPayoutDestinationForm">
            <label class="form-field">Account holder name<input name="beneficiary_name" type="text" maxlength="120" required value="${escapeHTML(destination?.beneficiary_name || '')}"></label>
            <label class="form-field">Mobile Money network<select name="network" required><option value="">Choose network</option><option value="MTN"${destination?.network === 'MTN' ? ' selected' : ''}>MTN</option><option value="AIRTEL"${destination?.network === 'AIRTEL' ? ' selected' : ''}>Airtel</option></select></label>
            <label class="form-field">Uganda phone number<input name="phone_number" type="tel" inputmode="tel" autocomplete="tel" placeholder="+256 7XX XXX XXX" pattern="\\+?2567[0-9]{8}" required value="${escapeHTML(destination?.phone_number ? `+${destination.phone_number}` : '')}"></label>
            <label class="check-filter full-width"><input name="terms_accepted" type="checkbox" required><span>I accept the updated seller terms: 5% commission is deducted from eligible Flutterwave Mobile Money settlements, retained on returns; payouts go to this verified number. Cash-on-delivery commission and refunds remain manual.</span></label>
            <input name="terms_version" type="hidden" value="seller-v2-2026-11-19">
            <p class="form-note">${destination?.verified_at ? `Verified ${escapeHTML(time(destination.verified_at))}. Changing these details removes verification until reviewed again.` : 'Not verified yet. Saving changes requires administrator verification.'}</p>
            <button type="submit">Save payout details</button><p class="portal-form-message" id="sellerPayoutStatus" role="status" aria-live="polite"></p>
        </form>
    </section>
    <section class="portal-return-workflow"><h2>Seller settlements</h2>
        ${(settlements || []).length ? `<div class="portal-admin-application-list">${settlements.map(settlement => `<article class="portal-card">
            <h3>Order ${escapeHTML(settlement.order_id.slice(0, 8).toUpperCase())}</h3>
            <p>Gross ${money(settlement.gross_ugx)} · Commission ${money(settlement.commission_ugx)} · Refunds ${money(settlement.refunds_ugx)}</p>
            <p><strong>Net settlement ${money(settlement.amount_ugx)}</strong> · ${escapeHTML(statusLabel(settlement.status))}</p>
            ${settlement.transfer_reference ? `<p>Flutterwave reference: ${escapeHTML(settlement.transfer_reference)}</p>` : ''}
            ${settlement.failure_message ? `<p>${escapeHTML(settlement.failure_message)}</p>` : ''}
            ${settlement.paid_at ? `<p>Paid ${escapeHTML(time(settlement.paid_at))}</p>` : ''}
        </article>`).join('')}</div>` : '<div class="portal-cart-empty"><h3>No settlements yet</h3><p>Verified Mobile Money orders become eligible after delivery and the return window.</p></div>'}
    </section>`;

    document.getElementById('sellerPayoutDestinationForm').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const status = document.getElementById('sellerPayoutStatus');
        button.disabled = true;
        try {
            const { error } = await supabase.rpc('save_seller_payout_destination', {
                p_beneficiary_name: form.elements.beneficiary_name.value.trim(),
                p_network: form.elements.network.value,
                p_phone_number: form.elements.phone_number.value.trim(),
                p_terms_accepted: form.elements.terms_accepted.checked,
                p_terms_version: form.elements.terms_version.value
            });
            if (error) throw error;
            statusMessage(status, 'Payout details saved. An administrator must verify them before transfers.');
            window.setTimeout(() => window.location.reload(), 700);
        } catch (error) {
            console.error('Unable to save seller payout details.', error);
            statusMessage(status, `Payout details could not be saved: ${error.message}`, true);
            button.disabled = false;
        }
    });
}

async function initializeAdminSettlements() {
    if (route !== 'pages/admin/settlements.html') return;
    const profile = await requireRole('admin');
    if (!profile) return;
    const returnWindowEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const refresh = async () => {
        content.innerHTML = '<p class="portal-callout">Loading eligible orders and settlements…</p>';
        const [{ data: orders, error: ordersError }, { data: settlements, error: settlementsError }, { data: destinations, error: destinationsError }] = await Promise.all([
            supabase.from('orders')
                .select('id, seller_id, delivered_at, delivery_city')
                .eq('status', 'delivered')
                .eq('payment_method', 'mobile_money')
                .eq('payment_status', 'paid')
                .lte('delivered_at', returnWindowEnd)
                .order('delivered_at', { ascending: true })
                .limit(100),
            supabase.from('seller_settlements')
                .select('id, order_id, seller_id, gross_ugx, commission_ugx, refunds_ugx, amount_ugx, status, transfer_id, transfer_reference, failure_message, created_at, paid_at')
                .order('created_at', { ascending: false })
                .limit(200),
            supabase.from('seller_payout_destinations')
                .select('seller_id, beneficiary_name, network, phone_number, verified_at, updated_at')
                .order('updated_at', { ascending: false })
                .limit(200)
        ]);
        if (ordersError) throw ordersError;
        if (settlementsError) throw settlementsError;
        if (destinationsError) throw destinationsError;

        const settlementRows = settlements || [];
        const destinationRows = destinations || [];
        const sellerIds = [...new Set([
            ...(orders || []).map(order => order.seller_id),
            ...settlementRows.map(settlement => settlement.seller_id),
            ...destinationRows.map(destination => destination.seller_id)
        ])];
        const { data: sellers, error: sellerError } = sellerIds.length
            ? await supabase.from('profiles').select('id, shop_name, display_name').in('id', sellerIds)
            : { data: [], error: null };
        if (sellerError) throw sellerError;
        const sellerById = new Map((sellers || []).map(seller => [seller.id, seller]));
        const destinationBySeller = new Map(destinationRows.map(destination => [destination.seller_id, destination]));
        const settledOrders = new Set(settlementRows.map(settlement => settlement.order_id));
        const eligibleOrders = (orders || []).filter(order => !settledOrders.has(order.id));

        content.innerHTML = `<section class="portal-return-workflow"><h2>Verify seller payout destinations</h2>
            <p class="portal-callout">Review the beneficiary and phone number with the seller before verifying. Transfers require this explicit verification.</p>
            ${destinationRows.length ? `<div class="portal-admin-application-list">${destinationRows.map(destination => {
                const seller = sellerById.get(destination.seller_id);
                return `<article class="portal-card"><h3>${escapeHTML(seller?.shop_name || seller?.display_name || 'Seller')}</h3>
                    <p>${escapeHTML(destination.beneficiary_name)} · ${escapeHTML(destination.network)} · +${escapeHTML(destination.phone_number)}</p>
                    <p>${destination.verified_at ? `Verified ${escapeHTML(time(destination.verified_at))}` : 'Awaiting verification'}</p>
                    ${destination.verified_at ? '' : `<button type="button" data-verify-payout="${escapeHTML(destination.seller_id)}">Verify payout destination</button>`}
                </article>`;
            }).join('')}</div>` : '<p class="portal-callout">No seller payout destinations have been submitted.</p>'}
        </section>
        <section class="portal-return-workflow"><h2>Prepare eligible settlements</h2>
            <p class="portal-callout">Only verified Mobile Money orders delivered more than 3 days ago, with no open returns, can be prepared.</p>
            ${eligibleOrders.length ? `<div class="portal-admin-application-list">${eligibleOrders.map(order => {
                const seller = sellerById.get(order.seller_id);
                const destination = destinationBySeller.get(order.seller_id);
                return `<article class="portal-card"><h3>Order ${escapeHTML(order.id.slice(0, 8).toUpperCase())}</h3>
                    <p>${escapeHTML(seller?.shop_name || seller?.display_name || 'Seller')} · ${escapeHTML(order.delivery_city || 'Delivery location unavailable')}</p>
                    <p>Delivered ${escapeHTML(time(order.delivered_at))} · ${destination?.verified_at ? 'Payout details verified' : 'Payout details not verified'}</p>
                    <button type="button" data-create-settlement="${escapeHTML(order.id)}">Prepare settlement</button>
                </article>`;
            }).join('')}</div>` : '<p class="portal-callout">No delivered orders are waiting for settlement.</p>'}
        </section>
        <section class="portal-return-workflow"><h2>Settlement transfers</h2>
            ${settlementRows.length ? `<div class="portal-admin-application-list">${settlementRows.map(settlement => `<article class="portal-card">
                <h3>${escapeHTML(sellerById.get(settlement.seller_id)?.shop_name || sellerById.get(settlement.seller_id)?.display_name || 'Seller')} · Order ${escapeHTML(settlement.order_id.slice(0, 8).toUpperCase())}</h3>
                <p>Gross ${money(settlement.gross_ugx)} − commission ${money(settlement.commission_ugx)} − refunds ${money(settlement.refunds_ugx)} = <strong>${money(settlement.amount_ugx)}</strong></p>
                <p>Status: ${escapeHTML(statusLabel(settlement.status))}${settlement.transfer_reference ? ` · Reference ${escapeHTML(settlement.transfer_reference)}` : ''}</p>
                ${settlement.failure_message ? `<p>${escapeHTML(settlement.failure_message)}</p>` : ''}
                ${settlement.status === 'ready' ? `<button type="button" data-send-settlement="${escapeHTML(settlement.id)}"${destinationBySeller.get(settlement.seller_id)?.verified_at ? '' : ' disabled'}>Send via Flutterwave</button>` : ''}
                ${['pending', 'unknown'].includes(settlement.status) && settlement.transfer_id ? `<button type="button" data-verify-settlement="${escapeHTML(settlement.id)}">Check transfer status</button>` : ''}
                ${['processing', 'unknown'].includes(settlement.status) && !settlement.transfer_id ? '<p class="form-note">Unknown provider result: reconcile by transfer reference in Flutterwave before taking further action.</p>' : ''}
            </article>`).join('')}</div>` : '<p class="portal-callout">No settlements have been prepared.</p>'}
        </section><p class="portal-form-message" id="adminSettlementStatus" role="status" aria-live="polite"></p>`;

        content.onclick = async event => {
            const button = event.target.closest('[data-verify-payout], [data-create-settlement], [data-send-settlement], [data-verify-settlement]');
            if (!button || button.disabled) return;
            button.disabled = true;
            const status = document.getElementById('adminSettlementStatus');
            try {
                if (button.dataset.verifyPayout) {
                    const { error } = await supabase.rpc('admin_verify_seller_payout_destination', { p_seller_id: button.dataset.verifyPayout });
                    if (error) throw error;
                    statusMessage(status, 'Payout destination verified.');
                } else if (button.dataset.createSettlement) {
                    const { error } = await supabase.rpc('admin_create_seller_settlement', { p_order_id: button.dataset.createSettlement });
                    if (error) throw error;
                    statusMessage(status, 'Settlement prepared. Review the amount before sending.');
                } else {
                    const action = button.dataset.sendSettlement ? 'transfer' : 'verify_transfer';
                    const id = button.dataset.sendSettlement || button.dataset.verifySettlement;
                    const { data, error } = await supabase.functions.invoke('flutterwave-payouts', { body: { action, id } });
                    if (error) throw error;
                    if (data?.error) throw new Error(data.error);
                    statusMessage(status, data?.message || 'Payment operation updated.');
                }
                await refresh();
            } catch (error) {
                console.error('Unable to update a seller settlement.', error);
                statusMessage(status, `Settlement action failed: ${error.message}`, true);
                button.disabled = false;
            }
        };
    };

    await refresh();
}

async function initialize() {
    if (!isCommerceRoute()) {
        await initializeMarketplace();
        return;
    }
    if (!supabase) {
        notice('Marketplace backend is not configured. Configure Supabase and run the commerce migration before using live products, checkout, or notifications.', true);
        return;
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        console.error('Unable to read the commerce user session.', sessionError);
        notice(`Sign-in status could not be loaded: ${sessionError.message}`, true);
        return;
    }
    currentUser = sessionData.session?.user || null;
    try {
        await initializeMarketplace();
        await initializeWishlist();
        await initializeProfileSettings();
        await initializeProductDetails();
        await initializeStorefront();
        await initializeShopProfile();
        await initializeSearchPage();
        await initializeProductManagement();
        await initializeOrders();
        await initializeAdminApplications();
        await initializeAdminDeliveryAssignment();
        await initializeSellerSettlements();
        await initializeAdminSettlements();
        await initializeReturnRequests();
        await initializeCartAndCheckout();
        await initializeNotifications();
    } catch (error) {
        console.error('A marketplace feature failed to load.', error);
        notice(`This marketplace feature could not be loaded: ${error.message}`, true);
    }
}

if (supabase) {
    void initialize();
} else if (isCommerceRoute() && content) {
    notice('Marketplace backend is not configured. Configure Supabase and run the commerce migration before using live products, checkout, or notifications.', true);
} else {
    void initializeMarketplace();
}
