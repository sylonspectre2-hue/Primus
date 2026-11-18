(() => {
    const preloader = document.createElement('div');
    preloader.className = 'primus-preloader';
    preloader.setAttribute('role', 'status');
    preloader.setAttribute('aria-label', 'Loading Primus');
    preloader.setAttribute('aria-live', 'polite');
    preloader.innerHTML = '<div class="primus-preloader-glass"><span class="primus-preloader-orb" aria-hidden="true"><i></i><i></i><i></i></span><strong>primus<span>.</span></strong><p>Preparing your experience</p><span class="primus-preloader-progress" aria-hidden="true"><i></i></span></div>';
    document.body.appendChild(preloader);

    let preloaderDismissed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const preloaderStartedAt = performance.now();
    const minimumPreloaderTime = reducedMotion ? 150 : 650;
    const maximumPreloaderTime = reducedMotion ? 700 : 1600;
    const dismissPreloader = () => {
        if (preloaderDismissed) return;
        preloaderDismissed = true;
        const remainingTime = Math.max(0, minimumPreloaderTime - (performance.now() - preloaderStartedAt));
        window.setTimeout(() => {
            preloader.classList.add('is-hidden');
            window.setTimeout(() => preloader.remove(), reducedMotion ? 220 : 500);
        }, remainingTime);
    };
    if (document.readyState === 'complete') dismissPreloader();
    else window.addEventListener('load', dismissPreloader, { once: true });
    window.setTimeout(dismissPreloader, maximumPreloaderTime);

    const body = document.body;
    const sitePage = body.dataset.sitePage || (body.dataset.route ? 'portal' : 'home');
    const route = body.dataset.route || '';
    const routeDepth = route ? route.split('/').length - 1 : 0;
    const rootPrefix = route ? '../'.repeat(routeDepth) : sitePage === 'marketplace' ? '../../' : '';
    let favicon = document.querySelector('link[rel~="icon"]');
    if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
    }
    favicon.type = 'image/svg+xml';
    favicon.href = `${rootPrefix}assets/primus-favicon.svg`;
    const oldHeader = document.querySelector('.site-header, .market-header, .portal-header');
    if (!oldHeader) return;
    const avatarOptions = [
        { id: 'orbit', label: 'Orbit', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="7"/><ellipse cx="24" cy="24" rx="20" ry="9" transform="rotate(-28 24 24)"/><circle cx="39" cy="14" r="2.5"/></svg>' },
        { id: 'sunrise', label: 'Sunrise', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 33h30M14 33a10 10 0 0 1 20 0M24 7v5m-13 1 4 4m22-4-4 4M7 23h6m22 0h6"/></svg>' },
        { id: 'leaf', label: 'Leaf', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M39 9C20 8 10 16 11 29c1 8 9 11 16 6C35 29 38 18 39 9Z"/><path d="M9 40c5-10 12-16 23-22"/></svg>' },
        { id: 'waves', label: 'Waves', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 18c5 0 5-5 10-5s5 5 10 5 5-5 10-5 5 5 8 5M5 27c5 0 5-5 10-5s5 5 10 5 5-5 10-5 5 5 8 5M5 36c5 0 5-5 10-5s5 5 10 5 5-5 10-5 5 5 8 5"/></svg>' },
        { id: 'mountain', label: 'Mountain', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m5 38 14-24 8 13 5-8 11 19H5Z"/><path d="m16 20 3 4 3-2m4 5 4 1"/></svg>' },
        { id: 'spark', label: 'Spark', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 5 4.5 14.5L43 24l-14.5 4.5L24 43l-4.5-14.5L5 24l14.5-4.5L24 5Z"/><path d="m38 5 1.5 4.5L44 11l-4.5 1.5L38 17l-1.5-4.5L32 11l4.5-1.5L38 5Z"/></svg>' },
        { id: 'bloom', label: 'Bloom', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 21c-9-13 5-18 7-8 1 4-2 7-7 8Zm3 3c13-9 18 5 8 7-4 1-7-2-8-7Zm-3 3c9 13-5 18-7 8-1-4 2-7 7-8Zm-3-3c-13 9-18-5-8-7 4-1 7 2 8 7Z"/><circle cx="24" cy="24" r="3"/></svg>' },
        { id: 'bolt', label: 'Bolt', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M27 5 11 27h11l-2 16 17-24H25l2-14Z"/></svg>' }
    ];
    window.PRIMUS_AVATARS = avatarOptions;

    const marketplaceSearch = oldHeader.querySelector('.market-search');
    if (marketplaceSearch) marketplaceSearch.remove();
    const oldTopbar = document.querySelector('.announcement-bar, .market-banner, .portal-topbar');
    if (oldTopbar) oldTopbar.remove();

    const cartButtonId = sitePage === 'marketplace' ? 'cartOpen' : 'siteCart';
    const wishlistButtonId = sitePage === 'marketplace' ? 'wishlistButton' : 'siteWishlistButton';
    const cartCountId = sitePage === 'home' ? 'bagCount' : sitePage === 'marketplace' ? 'cartCount' : 'portalBagCount';
    const wishlistCountId = sitePage === 'marketplace' ? 'wishlistCount' : 'siteWishlistCount';
    const href = path => `${rootPrefix}${path}`;
    const markup = `
        <header class="primus-site-nav">
            <button class="site-nav-menu" id="menuToggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="mainNav">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            </button>
            <a class="site-nav-brand" href="${href('index.html')}" aria-label="Primus home">primus<span>.</span></a>
            <nav class="site-nav-links main-nav" id="mainNav" aria-label="Main navigation">
                <a href="${href('pages/marketplace/index.html')}">Marketplace</a>
                <a href="${href('pages/buyer-dashboard/wishlist.html')}">Saved items</a>
                <a href="${href('pages/categories/index.html')}">Categories</a>
                <a href="${href('pages/services/index.html')}">Services</a>
                <a href="${href('pages/landing/become-a-seller.html')}">Sell on Primus</a>
                <a href="${href('pages/messages/index.html')}">Messages</a>
                <a href="${href('pages/delivery/tracking.html')}">Track delivery</a>
            </nav>
            <div class="site-nav-actions">
                <button class="site-nav-search" id="siteSearchButton" type="button" aria-label="Search Primus" aria-expanded="false" aria-controls="primusSearchOverlay">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>
                </button>
                <button class="site-nav-wishlist" id="${wishlistButtonId}" type="button" aria-label="Wishlist">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.7c0 5-8.8 10.1-8.8 10.1S3.2 13.7 3.2 8.7A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.8 2.3Z"/></svg>
                    <span>Saved</span><span class="site-nav-count" id="${wishlistCountId}">0</span>
                </button>
                <button class="site-theme-toggle" id="themeToggle" type="button" aria-pressed="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.6 8.6 0 1 0 20.2 15Z"/></svg>
                    <span>Dark</span>
                </button>
                <div class="site-account-wrap">
                    <button class="site-account-button" id="siteAccountButton" type="button" aria-label="Open account menu" aria-expanded="false" aria-controls="siteAccountMenu">
                        <span class="site-account-avatar" id="siteAccountAvatar" data-avatar="orbit">${avatarOptions[0].svg}</span>
                        <span class="site-account-button-label" id="siteAccountButtonLabel">Account</span>
                        <svg class="site-account-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>
                    </button>
                    <div class="site-account-menu" id="siteAccountMenu" hidden>
                        <div class="site-account-summary">
                            <span class="site-account-avatar site-account-avatar-large" id="siteAccountMenuAvatar" data-avatar="orbit">${avatarOptions[0].svg}</span>
                            <span><strong id="siteAccountName">Welcome to Primus</strong><small id="siteAccountMeta">Sign in to manage your account</small></span>
                        </div>
                        <a id="siteAccountProfile" href="${href('pages/buyer-dashboard/profile.html')}" hidden>Profile &amp; avatar</a>
                        <a id="siteAccountOrders" href="${href('pages/buyer-dashboard/orders.html')}" hidden>Orders</a>
                        <a id="siteAccountMessages" href="${href('pages/messages/index.html')}" hidden>Messages</a>
                        <a id="siteAccountTracking" href="${href('pages/delivery/tracking.html')}" hidden>Track delivery</a>
                        <a id="siteAccountSettings" href="${href('pages/buyer-dashboard/settings.html')}" hidden>Account settings</a>
                        <a id="siteAccountAdmin" href="${href('pages/admin/index.html')}" hidden>Admin dashboard</a>
                        <span class="site-account-divider" aria-hidden="true"></span>
                        <a id="siteAccountSignIn" href="${href('pages/auth/login.html')}">Sign in</a>
                        <a id="siteAccountRegister" href="${href('pages/auth/register.html')}">Create account</a>
                        <button id="siteAccountSignOut" type="button" hidden>Sign out</button>
                        <p class="site-account-status" id="siteAccountStatus" role="status" hidden></p>
                    </div>
                </div>
                <button class="site-nav-cart" id="${cartButtonId}" type="button" aria-label="Open shopping bag">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 11.1a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>
                    <span>Bag</span><span class="site-nav-count" id="${cartCountId}">0</span>
                </button>
            </div>
        </header>`;

    oldHeader.insertAdjacentHTML('beforebegin', markup);
    const siteHeader = oldHeader.previousElementSibling;
    if (marketplaceSearch) siteHeader.after(marketplaceSearch);
    oldHeader.remove();

    const searchOverlayMarkup = `
        <div class="primus-search-overlay" id="primusSearchOverlay" role="dialog" aria-modal="true" aria-labelledby="primusSearchTitle" hidden>
            <section class="primus-search-panel">
                <div class="primus-search-topline">
                    <a class="primus-search-brand" href="${href('index.html')}" aria-label="Primus home">primus<span>.</span></a>
                    <span>Find something good</span>
                    <button class="primus-search-close" type="button" aria-label="Close search">&times;</button>
                </div>
                <div class="primus-search-intro">
                    <p class="primus-search-eyebrow">A good find starts here</p>
                    <h1 id="primusSearchTitle">What are you looking for?</h1>
                    <p>Search products, categories, and local shops.</p>
                </div>
                <form class="primus-search-form" id="primusGlobalSearchForm" role="search">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>
                    <label class="sr-only" for="primusGlobalSearchInput">Search products, categories, and shops</label>
                    <input id="primusGlobalSearchInput" type="search" placeholder="Try “coffee”, “fashion”, or a shop name" autocomplete="off">
                    <button type="submit">Search</button>
                </form>
                <div class="primus-search-body">
                    <div class="primus-search-popular">
                        <span>Popular</span>
                        <button type="button" data-search-term="Fashion">Fashion</button>
                        <button type="button" data-search-term="Home">Home</button>
                        <button type="button" data-search-term="Beauty">Beauty</button>
                        <button type="button" data-search-term="Electronics">Electronics</button>
                    </div>
                    <p class="primus-search-status" id="primusSearchStatus" role="status" aria-live="polite">Start typing to explore local finds.</p>
                    <div class="primus-search-results" id="primusSearchResults"></div>
                </div>
                <p class="primus-search-footer">Thoughtfully found, right here in Uganda.</p>
            </section>
        </div>`;
    siteHeader.insertAdjacentHTML('afterend', searchOverlayMarkup);

    const root = document.documentElement;
    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem('primus-theme') || 'light';
    } catch (error) {
        console.error('Unable to read the saved Primus theme.', error);
    }
    applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href('assets/css/site-nav.css');
    document.head.appendChild(stylesheet);

    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap';
    document.head.appendChild(fonts);

    const accountButton = document.getElementById('siteAccountButton');
    const accountMenu = document.getElementById('siteAccountMenu');
    const accountWrap = document.querySelector('.site-account-wrap');
    const accountLinks = {
        profile: document.getElementById('siteAccountProfile'),
        orders: document.getElementById('siteAccountOrders'),
        messages: document.getElementById('siteAccountMessages'),
        tracking: document.getElementById('siteAccountTracking'),
        settings: document.getElementById('siteAccountSettings'),
        admin: document.getElementById('siteAccountAdmin'),
        signIn: document.getElementById('siteAccountSignIn'),
        register: document.getElementById('siteAccountRegister'),
        signOut: document.getElementById('siteAccountSignOut')
    };

    function updateAccountUI(user, profile = null) {
        const role = profile?.role || '';
        const avatar = avatarOptions.find(option => option.id === profile?.avatar_id) || avatarOptions[0];
        document.querySelectorAll('.site-account-avatar').forEach(element => {
            element.dataset.avatar = avatar.id;
            element.innerHTML = avatar.svg;
        });
        const displayName = profile?.display_name || user?.email?.split('@')[0] || '';
        document.getElementById('siteAccountButtonLabel').textContent = user ? (displayName || 'Account') : 'Account';
        accountButton.setAttribute('aria-label', user
            ? `Open account menu for ${displayName || user.email || 'your account'}`
            : 'Open account menu');
        document.getElementById('siteAccountName').textContent = user ? (displayName || 'Your Primus account') : 'Welcome to Primus';
        const roleLabels = { buyer: 'Buyer', seller: 'Seller', rider: 'Rider', admin: 'Super administrator' };
        document.getElementById('siteAccountMeta').textContent = user
            ? `${roleLabels[role] || 'Primus member'} · ${user.email || ''}`
            : 'Sign in to manage your account';

        const setVisible = (element, visible) => { element.hidden = !visible; };
        ['profile', 'orders', 'messages', 'tracking', 'settings'].forEach(key => setVisible(accountLinks[key], Boolean(user)));
        setVisible(accountLinks.admin, Boolean(user && role === 'admin'));
        setVisible(accountLinks.signIn, !user);
        setVisible(accountLinks.register, !user);
        setVisible(accountLinks.signOut, Boolean(user));
        accountLinks.profile.href = href('pages/buyer-dashboard/profile.html');
        accountLinks.messages.href = href('pages/messages/index.html');
        accountLinks.tracking.href = href('pages/delivery/tracking.html');
        const roleDestinations = {
            buyer: { orders: 'pages/buyer-dashboard/orders.html', settings: 'pages/buyer-dashboard/settings.html', ordersLabel: 'Orders' },
            seller: { orders: 'pages/seller-dashboard/orders.html', settings: 'pages/seller-dashboard/settings.html', ordersLabel: 'Shop orders' },
            rider: { orders: 'pages/rider-dashboard/jobs.html', settings: 'pages/rider-dashboard/settings.html', ordersLabel: 'Delivery jobs' },
            admin: { orders: 'pages/admin/orders.html', settings: 'pages/admin/settings.html', ordersLabel: 'All orders' }
        };
        const destination = roleDestinations[role] || roleDestinations.buyer;
        accountLinks.orders.href = href(destination.orders);
        accountLinks.orders.textContent = destination.ordersLabel;
        accountLinks.settings.href = href(destination.settings);
        accountLinks.admin.href = href('pages/admin/index.html');
        accountLinks.signIn.href = href('pages/auth/login.html');
        accountLinks.register.href = href('pages/auth/register.html');
        const status = document.getElementById('siteAccountStatus');
        status.hidden = true;
        status.textContent = '';
    }

    window.PRIMUS_UPDATE_ACCOUNT_UI = updateAccountUI;
    accountButton.addEventListener('click', () => {
        const isOpen = accountButton.getAttribute('aria-expanded') === 'true';
        accountMenu.hidden = isOpen;
        accountButton.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', event => {
        if (!accountWrap.contains(event.target) && !accountMenu.hidden) {
            accountMenu.hidden = true;
            accountButton.setAttribute('aria-expanded', 'false');
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !accountMenu.hidden) {
            accountMenu.hidden = true;
            accountButton.setAttribute('aria-expanded', 'false');
            accountButton.focus();
        }
    });
    accountMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
        accountMenu.hidden = true;
        accountButton.setAttribute('aria-expanded', 'false');
    }));

    const searchTrigger = document.getElementById('siteSearchButton');
    const searchOverlay = document.getElementById('primusSearchOverlay');
    const searchInput = document.getElementById('primusGlobalSearchInput');
    const searchForm = document.getElementById('primusGlobalSearchForm');
    const searchStatus = document.getElementById('primusSearchStatus');
    const searchResults = document.getElementById('primusSearchResults');
    let searchTimer;
    let searchRequestId = 0;

    function closeSearch() {
        searchOverlay.hidden = true;
        document.body.classList.remove('primus-search-open');
        searchTrigger.setAttribute('aria-expanded', 'false');
        searchTrigger.focus();
    }

    async function runGlobalSearch(query) {
        const requestId = ++searchRequestId;
        const normalizedQuery = query.trim();
        searchResults.replaceChildren();
        if (normalizedQuery.length < 2) {
            searchStatus.textContent = 'Type at least two characters, or choose a popular search.';
            return;
        }

        searchStatus.textContent = 'Looking for local finds…';
        try {
            const supabase = await window.PRIMUS_SUPABASE_READY;
            const { data, error } = await supabase
                .from('products')
                .select('id, name, category, seller_name, price_ugx, created_at')
                .eq('is_published', true)
                .textSearch('search_vector', normalizedQuery, { type: 'websearch', config: 'simple' })
                .order('created_at', { ascending: false })
                .limit(6);
            if (error) throw error;
            if (requestId !== searchRequestId) return;

            if (!data?.length) {
                searchStatus.textContent = `No matches for “${normalizedQuery}”. Try another product or shop.`;
                return;
            }

            data.forEach(product => {
                const result = document.createElement('a');
                result.className = 'primus-search-result';
                result.href = `${href('pages/products/product-details.html')}?product=${encodeURIComponent(product.id)}`;
                const description = document.createElement('span');
                description.className = 'primus-search-result-copy';
                const name = document.createElement('strong');
                name.textContent = product.name;
                const meta = document.createElement('small');
                meta.textContent = `${product.category} · ${product.seller_name}`;
                const price = document.createElement('span');
                price.className = 'primus-search-result-price';
                price.textContent = `UGX ${new Intl.NumberFormat('en-UG').format(Number(product.price_ugx) || 0)}`;
                description.append(name, meta, price);
                const arrow = document.createElement('span');
                arrow.className = 'primus-search-result-arrow';
                arrow.setAttribute('aria-hidden', 'true');
                arrow.textContent = '↗';
                result.append(description, arrow);
                searchResults.append(result);
            });
            searchStatus.textContent = `${data.length} ${data.length === 1 ? 'find' : 'finds'} to explore`;
        } catch (error) {
            if (requestId !== searchRequestId) return;
            console.error('Primus global search failed.', error);
            searchStatus.textContent = 'Search is unavailable right now. Please try again shortly.';
        }
    }

    searchTrigger.addEventListener('click', () => {
        searchOverlay.hidden = false;
        document.body.classList.add('primus-search-open');
        searchTrigger.setAttribute('aria-expanded', 'true');
        searchInput.focus();
    });
    searchOverlay.addEventListener('click', event => {
        if (event.target === searchOverlay || event.target.closest('.primus-search-close')) closeSearch();
    });
    searchInput.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => void runGlobalSearch(searchInput.value), 250);
    });
    searchForm.addEventListener('submit', event => {
        event.preventDefault();
        window.clearTimeout(searchTimer);
        void runGlobalSearch(searchInput.value);
    });
    searchOverlay.querySelectorAll('[data-search-term]').forEach(button => button.addEventListener('click', () => {
        searchInput.value = button.dataset.searchTerm;
        void runGlobalSearch(searchInput.value);
        searchInput.focus();
    }));
    document.addEventListener('keydown', event => {
        if (searchOverlay.hidden) return;
        if (event.key === 'Escape') {
            closeSearch();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...searchOverlay.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    function applyTheme(theme) {
        root.dataset.theme = theme;
        const toggle = document.getElementById('themeToggle');
        if (toggle) {
            toggle.setAttribute('aria-pressed', String(theme === 'dark'));
            toggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
            toggle.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
            toggle.querySelector('span').textContent = theme === 'dark' ? 'Light' : 'Dark';
            toggle.querySelector('svg').innerHTML = theme === 'dark'
                ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'
                : '<path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.6 8.6 0 1 0 20.2 15Z"/>';
        }
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = theme === 'dark' ? '#0c1118' : '#f7f8fb';
    }

    document.getElementById('themeToggle').addEventListener('click', () => {
        const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(theme);
        try {
            localStorage.setItem('primus-theme', theme);
        } catch (error) {
            console.error('Unable to save the Primus theme preference.', error);
        }
    });

    if (sitePage !== 'home') {
        const menuToggle = document.getElementById('menuToggle');
        const mainNav = document.getElementById('mainNav');
        menuToggle.addEventListener('click', () => {
            const isOpen = mainNav.classList.toggle('is-open');
            menuToggle.setAttribute('aria-expanded', String(isOpen));
            menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
        });
        mainNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
            mainNav.classList.remove('is-open');
            menuToggle.setAttribute('aria-expanded', 'false');
        }));
    }

    if (sitePage !== 'marketplace') {
        document.getElementById(cartButtonId).addEventListener('click', () => {
            window.location.href = href('pages/cart/index.html');
        });
        document.getElementById(wishlistButtonId).addEventListener('click', () => {
            window.location.href = href('pages/buyer-dashboard/wishlist.html');
        });
    } else {
        const savedWishlist = readCount('primus-wishlist');
        document.getElementById(wishlistCountId).textContent = String(savedWishlist);
    }
    if (sitePage !== 'marketplace') {
        document.getElementById(wishlistCountId).textContent = String(readCount('primus-wishlist'));
    }
    document.getElementById(cartCountId).textContent = String(readCartCount());

    window.addEventListener('storage', event => {
        if (event.key === 'primus-theme') applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
        if (event.key === 'primus-cart' || event.key === 'primus-cart-count') {
            document.getElementById(cartCountId).textContent = String(readCartCount());
        }
        if (event.key === 'primus-wishlist') {
            document.getElementById(wishlistCountId).textContent = String(readCount('primus-wishlist'));
        }
    });

    const configScript = document.createElement('script');
    configScript.src = href('assets/js/supabase-config.js');
    configScript.onload = () => {
        const featuresScript = document.createElement('script');
        featuresScript.type = 'module';
        featuresScript.src = href('assets/js/supabase-features.js');
        featuresScript.onload = () => {
            const commerceScript = document.createElement('script');
            commerceScript.type = 'module';
            commerceScript.src = href('assets/js/commerce-features.js');
            commerceScript.onerror = error => {
                console.error('Unable to load Primus marketplace features.', error);
                showBackendError('Marketplace services could not be loaded. Please refresh and try again.');
            };
            document.body.appendChild(commerceScript);
        };
        featuresScript.onerror = error => {
            console.error('Unable to load Primus realtime features.', error);
            showBackendError('Primus authentication and live features could not be loaded. Check that the project files are being served correctly.');
        };
        document.body.appendChild(featuresScript);
    };
    configScript.onerror = error => {
        console.error('Unable to load the Primus Supabase configuration file.', error);
        showBackendError('The Supabase configuration file could not be loaded. Check that the project files are being served correctly.');
    };
    document.head.appendChild(configScript);

    function showBackendError(message) {
        const content = document.getElementById('portalContent');
        if (!content) return;
        const notice = document.createElement('p');
        notice.className = 'portal-callout is-error';
        notice.textContent = message;
        content.prepend(notice);
    }

    function readCartCount() {
        try {
            const cart = JSON.parse(localStorage.getItem('primus-cart') || '[]');
            if (!Array.isArray(cart)) throw new TypeError('Saved Primus cart data must be an array.');
            return cart.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
        } catch (error) {
            console.error('Unable to read the saved Primus cart count.', error);
            return 0;
        }
    }

    function readCount(key) {
        try {
            const saved = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(saved)) throw new TypeError(`Saved ${key} data must be an array.`);
            return saved.length;
        } catch (error) {
            console.error(`Unable to read ${key}.`, error);
            return 0;
        }
    }
})();
