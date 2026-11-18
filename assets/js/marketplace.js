document.addEventListener('DOMContentLoaded', () => {
    let products = [
        { id: 'linen-shirt', name: 'Linen Blend Shirt', category: 'Fashion', seller: 'Mirembe Studio', price: 145000, rating: 4.8, reviews: 28, stock: 7, delivery: 'same-day', condition: 'new', verified: true, offer: false, badge: 'Local pick', image: 'https://images.unsplash.com/photo-1598554747436-c9293d6a588f?auto=format&fit=crop&w=750&q=85', description: 'An easy, breathable linen blend shirt made for warm days and everyday plans.' },
        { id: 'woven-tote', name: 'Woven Everyday Tote', category: 'Fashion', seller: 'Kampala Craft Co.', price: 89000, rating: 4.9, reviews: 34, stock: 11, delivery: 'standard', condition: 'handmade', verified: true, offer: true, badge: 'Handmade', image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=750&q=85', description: 'A roomy, hand-finished tote woven by local makers for errands, work, and weekends.' },
        { id: 'ceramic-vase', name: 'Soft Form Ceramic Vase', category: 'Home', seller: 'Clay & Form', price: 72000, rating: 4.7, reviews: 16, stock: 4, delivery: 'standard', condition: 'handmade', verified: true, offer: false, badge: 'Handmade', image: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=750&q=85', description: 'A softly sculpted ceramic vase made in small batches. Each piece has its own character.' },
        { id: 'glow-oil', name: 'Everyday Glow Oil', category: 'Beauty', seller: 'Nile Botanics', price: 55000, rating: 4.8, reviews: 42, stock: 18, delivery: 'same-day', condition: 'new', verified: true, offer: true, badge: 'Bestseller', image: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=750&q=85', description: 'A lightweight botanical face oil made with plant-based ingredients for a simple daily ritual.' },
        { id: 'studio-headphones', name: 'Studio Wireless Headphones', category: 'Electronics', seller: 'Urban Tech UG', price: 320000, rating: 4.6, reviews: 19, stock: 6, delivery: 'same-day', condition: 'new', verified: true, offer: false, badge: 'Top rated', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=750&q=85', description: 'Comfortable over-ear headphones with wireless listening and a clear, balanced sound.' },
        { id: 'smart-watch', name: 'Chronos Minimal Watch', category: 'Electronics', seller: 'Urban Tech UG', price: 240000, rating: 4.5, reviews: 13, stock: 0, delivery: 'standard', condition: 'new', verified: true, offer: true, badge: 'Special offer', image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=750&q=85', description: 'A clean, everyday watch with a comfortable strap and a timeless minimal face.' },
        { id: 'coffee-beans', name: 'Rwenzori Arabica Coffee', category: 'Groceries', seller: 'Good Grain', price: 38000, rating: 4.9, reviews: 51, stock: 24, delivery: 'same-day', condition: 'new', verified: false, offer: false, badge: 'Fresh batch', image: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=750&q=85', description: 'Locally sourced Arabica coffee with a smooth finish, roasted in small batches.' },
        { id: 'home-repair', name: 'Home Refresh Consultation', category: 'Services', seller: 'Kintu Home Care', price: 65000, rating: 4.7, reviews: 22, stock: 5, delivery: 'standard', condition: 'new', verified: true, offer: false, badge: 'Book a service', image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=750&q=85', description: 'A one-hour home visit with a local expert to plan small repairs and refresh projects.' }
    ];

    let productById = new Map(products.map(product => [product.id, product]));
    const productGrid = document.getElementById('productGrid');
    const catalogLayout = document.getElementById('catalogLayout');
    const detailPanel = document.getElementById('productDetail');
    const detailContent = document.getElementById('detailContent');
    const emptyState = document.getElementById('emptyState');
    const resultCount = document.getElementById('resultCount');
    const cartDrawer = document.getElementById('cartDrawer');
    const drawerBackdrop = document.getElementById('drawerBackdrop');
    const toast = document.getElementById('toast');
    let cart = readSavedArray('primus-cart')
        .filter(item => item && typeof item.id === 'string' && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)
        .map(item => ({ ...item, quantity: Number(item.quantity) }));
    let wishlist = [...new Set(readSavedArray('primus-wishlist').filter(id => typeof id === 'string'))];
    let toastTimer;
    let lastFocusedElement;
    let detailImages = [];

    const filterIds = ['categoryFilter', 'brandFilter', 'ratingFilter', 'deliveryFilter', 'conditionFilter', 'minPrice', 'maxPrice', 'verifiedFilter', 'stockFilter', 'saleFilter'];

    window.addEventListener('primus:catalog-updated', event => {
        if (!Array.isArray(event.detail)) return;
        products = event.detail;
        productById = new Map(products.map(product => [product.id, product]));
        const categoryFilter = document.getElementById('categoryFilter');
        const categories = [...new Set(products.map(product => product.category))].sort();
        const selectedCategory = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="">All categories</option>' + categories.map(category => `<option>${escapeHTML(category)}</option>`).join('');
        categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : '';
        const brandFilter = document.getElementById('brandFilter');
        const brands = [...new Set(products.map(product => product.seller))].sort();
        const selectedBrand = brandFilter.value;
        brandFilter.innerHTML = '<option value="">Any brand</option>' + brands.map(brand => `<option>${escapeHTML(brand)}</option>`).join('');
        brandFilter.value = brands.includes(selectedBrand) ? selectedBrand : '';
        renderProducts();
    });

    function readSavedArray(key) {
        const saved = localStorage.getItem(key);
        if (!saved) return [];
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed;
            throw new TypeError(`Saved ${key} data must be an array.`);
        } catch (error) {
            console.error(`Unable to load ${key}.`, error);
            window.setTimeout(() => showToast('Some saved marketplace data could not be loaded.'), 0);
            return [];
        }
    }

    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function formatPrice(price) {
        return `UGX ${new Intl.NumberFormat('en-UG').format(price)}`;
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('is-visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2300);
    }

    function saveState() {
        try {
            localStorage.setItem('primus-cart', JSON.stringify(cart));
            localStorage.setItem('primus-cart-count', String(cart.reduce((sum, item) => sum + item.quantity, 0)));
            localStorage.setItem('primus-wishlist', JSON.stringify(wishlist));
        } catch (error) {
            console.error('Unable to save marketplace state.', error);
            showToast('Your browser could not save the latest changes.');
        }
    }

    function renderProducts() {
        const query = document.getElementById('catalogSearch').value.trim().toLowerCase();
        const category = document.getElementById('categoryFilter').value;
        const brand = document.getElementById('brandFilter').value;
        const minimumRating = Number(document.getElementById('ratingFilter').value);
        const minimumPrice = Number(document.getElementById('minPrice').value) || 0;
        const maximumPrice = Number(document.getElementById('maxPrice').value) || Infinity;
        const delivery = document.getElementById('deliveryFilter').value;
        const condition = document.getElementById('conditionFilter').value;
        const verifiedOnly = document.getElementById('verifiedFilter').checked;
        const inStockOnly = document.getElementById('stockFilter').checked;
        const offersOnly = document.getElementById('saleFilter').checked;

        const filtered = products.filter(product => {
            const searchable = `${product.name} ${product.category} ${product.seller} ${product.description}`.toLowerCase();
            return (!query || searchable.includes(query))
                && (!category || product.category === category)
                && (!brand || product.seller === brand)
                && product.rating >= minimumRating
                && product.price >= minimumPrice
                && product.price <= maximumPrice
                && (!delivery || product.delivery === delivery)
                && (!condition || product.condition === condition)
                && (!verifiedOnly || product.verified)
                && (!inStockOnly || product.stock > 0)
                && (!offersOnly || product.offer);
        });

        const sort = document.getElementById('sortSelect').value;
        if (sort === 'price-low') filtered.sort((a, b) => a.price - b.price);
        if (sort === 'price-high') filtered.sort((a, b) => b.price - a.price);
        if (sort === 'rating') filtered.sort((a, b) => b.rating - a.rating);
        if (sort === 'newest') filtered.sort((a, b) => products.indexOf(b) - products.indexOf(a));

        const view = document.querySelector('.view-button.is-active').dataset.view;
        const density = document.getElementById('densitySelect').value;
        productGrid.dataset.view = view;
        productGrid.dataset.density = density;
        resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'find' : 'finds'} to explore`;
        emptyState.hidden = filtered.length !== 0;
        productGrid.hidden = filtered.length === 0;
        productGrid.innerHTML = filtered.map(renderProductCard).join('');
    }

    function renderProductCard(product) {
        const saved = wishlist.includes(product.id);
        return `<article class="product-card" data-product-id="${escapeHTML(product.id)}">
            <button class="product-photo product-open" type="button" data-action="details" aria-label="View ${escapeHTML(product.name)} details">
                <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
                <span class="product-badge">${escapeHTML(product.badge)}</span>
            </button>
            <button class="favorite-button" type="button" data-action="wishlist" aria-label="${saved ? 'Remove' : 'Add'} ${escapeHTML(product.name)} ${saved ? 'from' : 'to'} wishlist" aria-pressed="${saved}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.7c0 5-8.8 10.1-8.8 10.1S3.2 13.7 3.2 8.7A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.8 2.3Z"/></svg>
            </button>
            <p class="product-meta">${escapeHTML(product.category)}${product.verified ? ' · Verified seller' : ''}</p>
            <h3><button class="product-title product-open" type="button" data-action="details">${escapeHTML(product.name)}</button></h3>
            <p class="product-seller">${escapeHTML(product.seller)}</p>
            <p class="product-rating" aria-label="${product.rating} out of 5 stars">★ ${product.rating} <span>(${product.reviews})</span></p>
            <div class="product-bottom"><span class="product-price">${formatPrice(product.price)}</span>
                <button class="add-cart-button" type="button" data-action="add" ${product.stock === 0 ? 'disabled' : ''}>${product.stock === 0 ? 'Sold out' : 'Add to bag'}</button>
            </div>
        </article>`;
    }

    function openDetails(product) {
        const images = Array.isArray(product.images) && product.images.length
            ? product.images
            : [product.image];
        detailImages = images;
        const specifications = Object.entries(product.specifications || {})
            .filter(([, value]) => typeof value === 'string' && value.trim())
            .map(([key, value]) => [
                product.specificationLabels?.[key] || key.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()),
                value.trim()
            ]);
        detailContent.innerHTML = `<button class="detail-close" id="detailClose" aria-label="Close product details">&times;</button>
            <section class="detail-gallery" aria-label="Product photos">
                <img class="detail-image" id="detailMainImage" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}">
                ${images.length > 1 ? `<div class="detail-thumbnails" role="group" aria-label="Choose a product photo">${images.map((image, index) => `<button type="button" data-detail-image-index="${index}" aria-label="View product photo ${index + 1}" aria-pressed="${index === 0}"><img src="${escapeHTML(image)}" alt=""></button>`).join('')}</div>` : ''}
            </section>
            <p class="detail-category">${escapeHTML(product.category)}${product.verified ? ' · Verified seller' : ''}</p>
            <h2>${escapeHTML(product.name)}</h2>
            <p class="detail-seller">Sold by ${escapeHTML(product.seller)}</p>
            <p class="product-rating">★ ${product.rating} <span>(${product.reviews} reviews)</span></p>
            <p class="detail-price">${formatPrice(product.price)}</p>
            <p class="detail-description">${escapeHTML(product.description)}</p>
            <div class="detail-specs"><p><span>Availability</span><strong>${product.stock > 0 ? `${product.stock} in stock` : 'Currently unavailable'}</strong></p><p><span>Delivery</span><strong>${product.delivery === 'same-day' ? 'Same-day in Kampala' : 'Standard delivery'}</strong></p><p><span>Condition</span><strong>${product.condition === 'handmade' ? 'Handmade' : 'New'}</strong></p></div>
            ${specifications.length ? `<section class="detail-product-specs"><h3>Product details</h3><dl>${specifications.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl></section>` : ''}
            <button class="detail-add" data-action="add" data-product-id="${escapeHTML(product.id)}" ${product.stock === 0 ? 'disabled' : ''}>${product.stock === 0 ? 'Currently unavailable' : 'Add to bag'}</button>`;
        detailPanel.hidden = false;
        catalogLayout.classList.add('has-detail');
    }

    function addToCart(productId) {
        const product = productById.get(productId);
        if (!product || product.stock === 0) {
            showToast('This find is currently unavailable.');
            return;
        }
        const current = cart.find(item => item.id === productId);
        if (current) {
            if (current.quantity >= Math.min(product.stock, 99)) {
                showToast('You have added all available stock to your bag.');
                return;
            }
            current.quantity += 1;
        }
        else cart.push({ id: productId, quantity: 1 });
        saveState();
        renderCart();
        showToast(`${product.name} added to your bag.`);
    }

    function renderCart() {
        const count = cart.reduce((sum, item) => sum + item.quantity, 0);
        const hasUnavailableItems = cart.some(item => {
            const product = productById.get(item.id);
            return !product || product.stock <= 0 || item.quantity > product.stock;
        });
        document.getElementById('cartCount').textContent = String(count);
        document.getElementById('drawerCount').textContent = String(count);
        document.getElementById('cartSubtotal').textContent = formatPrice(cart.reduce((sum, item) => {
            const product = productById.get(item.id);
            return sum + (product ? product.price * item.quantity : 0);
        }, 0));
        document.getElementById('cartEmpty').hidden = cart.length > 0;
        document.getElementById('checkoutButton').disabled = cart.length === 0 || hasUnavailableItems;
        document.getElementById('cartItems').innerHTML = cart.map(item => {
            const product = productById.get(item.id);
            if (!product) {
                return `<article class="cart-item" data-product-id="${escapeHTML(item.id)}">
                    <div><h3>Unavailable product</h3><p>This item is no longer in the marketplace.</p></div>
                    <button class="cart-item-remove" data-cart-action="remove">Remove</button>
                </article>`;
            }
            return `<article class="cart-item" data-product-id="${escapeHTML(product.id)}">
                <img src="${escapeHTML(product.image)}" alt="">
                <div><h3>${escapeHTML(product.name)}</h3><p>${formatPrice(product.price)}${product.stock < item.quantity ? ' · quantity exceeds available stock' : ''}</p>
                    <div class="quantity-control"><button data-cart-action="decrease" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-cart-action="increase" aria-label="Increase quantity"${item.quantity >= Math.min(product.stock, 99) ? ' disabled' : ''}>+</button></div>
                </div>
                <button class="cart-item-remove" data-cart-action="remove">Remove</button>
            </article>`;
        }).join('');
    }

    function setCartOpen(isOpen) {
        if (isOpen) lastFocusedElement = document.activeElement;
        cartDrawer.hidden = !isOpen;
        drawerBackdrop.hidden = !isOpen;
        document.body.classList.toggle('drawer-open', isOpen);
        if (isOpen) document.getElementById('cartClose').focus();
        else if (lastFocusedElement) lastFocusedElement.focus();
    }

    function clearFilters() {
        filterIds.forEach(id => {
            const control = document.getElementById(id);
            if (control.type === 'checkbox') control.checked = false;
            else control.value = '';
        });
        document.getElementById('catalogSearch').value = '';
        document.getElementById('sortSelect').value = 'featured';
        renderProducts();
    }

    filterIds.forEach(id => document.getElementById(id).addEventListener('input', renderProducts));
    document.getElementById('sortSelect').addEventListener('change', renderProducts);
    document.getElementById('densitySelect').addEventListener('change', renderProducts);
    document.getElementById('searchForm').addEventListener('submit', event => {
        event.preventDefault();
        renderProducts();
    });
    document.getElementById('catalogSearch').addEventListener('input', renderProducts);
    document.querySelectorAll('.view-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.view-button').forEach(viewButton => {
                const isActive = viewButton === button;
                viewButton.classList.toggle('is-active', isActive);
                viewButton.setAttribute('aria-pressed', String(isActive));
            });
            renderProducts();
        });
    });

    productGrid.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const card = button.closest('[data-product-id]');
        const productId = button.dataset.productId || (card && card.dataset.productId);
        const action = button.dataset.action;
        if (action === 'details') openDetails(productById.get(productId));
        if (action === 'add') addToCart(productId);
        if (action === 'wishlist') {
            const isSaved = wishlist.includes(productId);
            wishlist = isSaved ? wishlist.filter(id => id !== productId) : [...wishlist, productId];
            saveState();
            document.getElementById('wishlistCount').textContent = String(wishlist.length);
            renderProducts();
            showToast(isSaved ? 'Removed from your wishlist.' : 'Saved to your wishlist.');
        }
    });

    detailPanel.addEventListener('click', event => {
        const imageButton = event.target.closest('[data-detail-image-index]');
        if (imageButton) {
            const imageIndex = Number(imageButton.dataset.detailImageIndex);
            if (Number.isInteger(imageIndex) && detailImages[imageIndex]) {
                document.getElementById('detailMainImage').src = detailImages[imageIndex];
                detailPanel.querySelectorAll('[data-detail-image-index]').forEach(button => {
                    button.setAttribute('aria-pressed', String(button === imageButton));
                });
            }
        }
        if (event.target.closest('#detailClose')) {
            detailPanel.hidden = true;
            catalogLayout.classList.remove('has-detail');
        }
        const addButton = event.target.closest('[data-action="add"]');
        if (addButton) addToCart(addButton.dataset.productId);
    });

    document.getElementById('cartItems').addEventListener('click', event => {
        const actionButton = event.target.closest('[data-cart-action]');
        if (!actionButton) return;
        const item = actionButton.closest('.cart-item');
        const productId = item.dataset.productId;
        const cartItem = cart.find(entry => entry.id === productId);
        if (!cartItem) return;
        if (actionButton.dataset.cartAction === 'increase') {
            const product = productById.get(productId);
            if (!product || cartItem.quantity >= Math.min(product.stock, 99)) {
                showToast('You have added all available stock to your bag.');
                return;
            }
            cartItem.quantity += 1;
        }
        if (actionButton.dataset.cartAction === 'decrease') cartItem.quantity -= 1;
        if (actionButton.dataset.cartAction === 'remove' || cartItem.quantity < 1) cart = cart.filter(entry => entry.id !== productId);
        saveState();
        renderCart();
    });

    document.getElementById('cartOpen').addEventListener('click', () => setCartOpen(true));
    document.getElementById('cartClose').addEventListener('click', () => setCartOpen(false));
    drawerBackdrop.addEventListener('click', () => setCartOpen(false));
    document.getElementById('continueShopping').addEventListener('click', () => setCartOpen(false));
    document.getElementById('checkoutButton').addEventListener('click', () => {
        window.location.href = '../../pages/cart/index.html';
    });
    document.getElementById('wishlistButton').addEventListener('click', () => {
        window.location.href = '../../pages/buyer-dashboard/wishlist.html';
    });
    document.getElementById('clearFilters').addEventListener('click', clearFilters);
    document.getElementById('emptyClear').addEventListener('click', clearFilters);
    document.getElementById('filterToggle').addEventListener('click', event => {
        const filterPanel = document.getElementById('filterPanel');
        const isCollapsed = filterPanel.classList.toggle('is-collapsed');
        event.currentTarget.setAttribute('aria-expanded', String(!isCollapsed));
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            if (!cartDrawer.hidden) setCartOpen(false);
            detailPanel.hidden = true;
            catalogLayout.classList.remove('has-detail');
        }
    });
    window.addEventListener('storage', event => {
        if (event.key === 'primus-cart') {
            cart = readSavedArray('primus-cart')
                .filter(item => item && typeof item.id === 'string' && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)
                .map(item => ({ ...item, quantity: Number(item.quantity) }));
            renderCart();
        }
        if (event.key === 'primus-wishlist') {
            wishlist = [...new Set(readSavedArray('primus-wishlist').filter(id => typeof id === 'string'))];
            document.getElementById('wishlistCount').textContent = String(wishlist.length);
            renderProducts();
        }
    });

    const parameters = new URLSearchParams(window.location.search);
    const initialCategory = parameters.get('category') || (parameters.get('type') === 'services' ? 'Services' : '');
    if ([...document.getElementById('categoryFilter').options].some(option => option.value === initialCategory || option.text === initialCategory)) {
        document.getElementById('categoryFilter').value = initialCategory;
    }
    document.getElementById('catalogSearch').value = parameters.get('q') || '';
    document.getElementById('wishlistCount').textContent = String(wishlist.length);
    renderCart();
    renderProducts();

    const requestedProduct = parameters.get('product');
    if (requestedProduct && productById.has(requestedProduct)) openDetails(productById.get(requestedProduct));
    if (parameters.get('openCart') === '1') setCartOpen(true);
});
