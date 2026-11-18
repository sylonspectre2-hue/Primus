const route = document.body.dataset.route || '';
const pageContent = document.getElementById('portalContent');
const routeDepth = route ? route.split('/').length - 1 : 0;
const appRoot = route ? '../'.repeat(routeDepth) : document.body.dataset.sitePage === 'marketplace' ? '../../' : '';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const liveMessageRoute = route.includes('messages');
const riderLocationRoute = route.startsWith('pages/rider-dashboard/')
    && (route.endsWith('/navigation.html') || route.endsWith('/active-delivery.html'));
const customerTrackingRoute = /tracking|live-tracking/.test(route) && !riderLocationRoute;
const liveFeatureRoute = liveMessageRoute || riderLocationRoute || customerTrackingRoute;
const backendUiRoute = liveFeatureRoute || route.startsWith('pages/auth/');
let supabase;
let currentUser;
let activeLocationWatch = null;
let activeLocationOrderId = null;
let activeRealtimeChannel = null;
let pendingLocationWrite = Promise.resolve();
let stopLocationSharing = async () => {};

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function showNotice(message, className = 'portal-callout') {
    if (!pageContent) return;
    const notice = makeElement('p', className, message);
    pageContent.replaceChildren(notice);
}

function showBackendInitializationError(message) {
    if (!pageContent) return;
    const notice = makeElement('p', 'portal-callout is-error', message);
    if (liveFeatureRoute) pageContent.replaceChildren(notice);
    else pageContent.prepend(notice);
}

function showInlineStatus(target, message, isError = false) {
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('is-error', isError);
}

function formatTime(value) {
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime())
        ? 'Time unavailable'
        : timestamp.toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' });
}

function orderLabel(order) {
    return `Order #${order.id.slice(0, 8).toUpperCase()}`;
}

function setBackendSetupNotice() {
    if ((!liveFeatureRoute && !route.startsWith('pages/auth/')) || !pageContent) return;
    const notice = makeElement('p', 'portal-callout');
    notice.textContent = 'Supabase is not configured yet. Add your project URL and publishable key in assets/js/supabase-config.js, then run supabase/schema.sql in your Supabase SQL Editor. Authentication, messages, and live tracking remain preview-only until setup is complete.';
    pageContent.prepend(notice);
}

function updateNavigationUser(user, profile = null) {
    if (typeof window.PRIMUS_UPDATE_ACCOUNT_UI === 'function') {
        window.PRIMUS_UPDATE_ACCOUNT_UI(user, profile);
    }
}

async function refreshNavigationProfile(user) {
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('display_name, role, avatar_id')
        .eq('id', user.id)
        .maybeSingle();
    if (error) {
        console.error('Unable to load the account menu profile.', error);
        return;
    }
    if (currentUser?.id === user.id) updateNavigationUser(user, profile);
}

function setAuthStatus(message, isError = false) {
    const status = document.getElementById('portalFormMessage');
    showInlineStatus(status, message, isError);
    if (isError) console.error(message);
}

function isServiceRoleKey(value) {
    const key = String(value);
    if (/service_role|^sb_secret_/i.test(key)) return true;
    const encodedClaims = key.split('.')[1];
    if (!encodedClaims) return false;
    try {
        const base64Claims = encodedClaims.replace(/-/g, '+').replace(/_/g, '/');
        const paddedClaims = base64Claims.padEnd(Math.ceil(base64Claims.length / 4) * 4, '=');
        return JSON.parse(atob(paddedClaims)).role === 'service_role';
    } catch (error) {
        console.warn('Unable to inspect the configured Supabase key type; Supabase will validate the key.', error);
        return false;
    }
}

async function redirectToDashboard(user) {
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
    if (error) {
        console.error('Unable to load the signed-in Primus profile.', error);
        setAuthStatus(`Signed in, but your Primus profile could not be loaded: ${error.message}`, true);
        return;
    }
    const dashboards = {
        buyer: 'buyer-dashboard',
        seller: 'seller-dashboard',
        rider: 'rider-dashboard',
        admin: 'admin'
    };
    const dashboard = profile && dashboards[profile.role];
    if (!dashboard) {
        setAuthStatus('Your account does not have an active Primus role yet. Contact the marketplace administrator.');
        return;
    }
    window.location.href = `${appRoot}pages/${dashboard}/index.html`;
}

async function redirectAfterSignIn(user) {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect) {
        try {
            const target = new URL(redirect, window.location.href);
            const rootPath = new URL(appRoot, window.location.href).pathname.replace(/\/$/, '');
            const pagesPrefix = `${rootPath}/pages/`;
            if (
                target.origin === window.location.origin
                && target.pathname.startsWith(pagesPrefix)
                && !target.pathname.startsWith(`${pagesPrefix}auth/`)
            ) {
                window.location.href = target.href;
                return;
            }
        } catch (error) {
            console.warn('Ignoring an invalid authentication redirect.', error);
        }
        console.warn('Ignoring an unsafe authentication redirect.');
    }
    await redirectToDashboard(user);
}

function setupAuthForm() {
    if (!route.startsWith('pages/auth/')) return;
    const form = document.getElementById('portalDemoForm');
    if (!form) return;
    const passwordNote = form.querySelector('#authPasswordNote') || form.querySelector('.form-note');
    const isRiderRegistration = route.endsWith('/rider-register.html');
    const isSellerRegistration = route.endsWith('/seller-register.html');
    if (passwordNote) {
        passwordNote.textContent = isRiderRegistration
            ? 'Supabase handles your password securely. Rider access stays pending until an administrator reviews your application.'
            : isSellerRegistration
                ? 'Supabase handles your password securely. Seller privileges require administrator approval.'
                : 'Supabase handles authentication. Passwords are never stored in Primus application tables.';
    }
    const mode = route.endsWith('/login.html') ? 'login'
        : route.endsWith('/register.html') || route.endsWith('/seller-register.html') || route.endsWith('/rider-register.html') ? 'register'
            : route.endsWith('/forgot-password.html') ? 'forgot-password'
                : route.endsWith('/reset-password.html') ? 'reset-password'
                    : '';
    if (!mode) return;
    const submitButton = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        event.stopPropagation();
        const email = form.querySelector('input[type="email"]')?.value.trim();
        const passwords = [...form.querySelectorAll('input[type="password"]')].map(input => input.value);
        if (mode === 'login' && (!email || !passwords[0])) {
            setAuthStatus('Enter your email and password.', true);
            return;
        }
        if (mode === 'register' && (!email || !passwords[0])) {
            setAuthStatus('Enter an email and password to create your account.', true);
            return;
        }
        if (mode === 'register' && isSellerRegistration && !form.elements.seller_terms?.checked) {
            setAuthStatus('Accept the seller terms before creating a seller application.', true);
            return;
        }
        if (mode === 'register' && isSellerRegistration && passwords[0] !== passwords[1]) {
            setAuthStatus('The passwords do not match.', true);
            return;
        }
        if (mode === 'reset-password' && passwords[0] !== passwords[1]) {
            setAuthStatus('The passwords do not match.', true);
            return;
        }
        if (submitButton) submitButton.disabled = true;
        setAuthStatus('Connecting securely…');
        try {
            if (mode === 'login') {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password: passwords[0] });
                if (error) throw error;
                await redirectAfterSignIn(data.user);
            } else if (mode === 'register') {
                const textInputs = [...form.querySelectorAll('input[type="text"]')];
                const fieldValue = name => form.elements.namedItem(name)?.value.trim() || '';
                const displayName = fieldValue('display_name') || textInputs[0]?.value.trim() || '';
                const phoneNumber = form.querySelector('input[type="tel"]')?.value.trim() || '';
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password: passwords[0],
                    options: {
                        data: {
                            display_name: displayName,
                            phone_number: phoneNumber,
                            shop_name: isSellerRegistration ? fieldValue('shop_name') : '',
                            requested_role: isRiderRegistration ? 'rider' : isSellerRegistration ? 'seller' : '',
                            shop_district: isSellerRegistration ? fieldValue('shop_district') : '',
                            shop_city: isSellerRegistration ? fieldValue('shop_city') : '',
                            shop_area: isSellerRegistration ? fieldValue('shop_area') : '',
                            shop_address: isSellerRegistration ? fieldValue('shop_address') : '',
                            shop_description: isSellerRegistration ? fieldValue('shop_description') : '',
                            seller_terms_accepted: isSellerRegistration && form.elements.seller_terms.checked ? 'true' : 'false',
                            seller_terms_version: isSellerRegistration ? fieldValue('seller_terms_version') : ''
                        }
                    }
                });
                if (error) throw error;
                if (isRiderRegistration) {
                    setAuthStatus(data.session
                        ? 'Your rider application has been submitted and is pending administrator approval.'
                        : 'Account created. Check your email to confirm it; your rider application is pending administrator approval.');
                } else if (!data.session) {
                    const approval = route.includes('seller-register')
                        ? ' Seller privileges require administrator approval.'
                        : '';
                    setAuthStatus(`Account created. Check your email to confirm the address before signing in.${approval}`);
                } else if (route.includes('seller-register')) {
                    setAuthStatus('Account created. Your profile details were saved; seller privileges require administrator approval.');
                } else {
                    await redirectToDashboard(data.user);
                }
            } else if (mode === 'forgot-password') {
                const redirectTo = new URL(`${appRoot}pages/auth/reset-password.html`, window.location.href).href;
                const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
                if (error) throw error;
                setAuthStatus('If the address belongs to an account, Supabase will email a password reset link.');
            } else {
                const { error } = await supabase.auth.updateUser({ password: passwords[0] });
                if (error) throw error;
                setAuthStatus('Password updated. You can now sign in with the new password.');
            }
        } catch (error) {
            console.error('Primus authentication request failed.', error);
            setAuthStatus(error.message || 'The authentication request could not be completed.', true);
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

function showAuthStatus(message, isError = false) {
    showInlineStatus(pageContent?.querySelector('#portalFormMessage'), message, isError);
    if (isError) console.error(message);
}

function appendMessage(container, message, userId, otherLabel = 'Order participant') {
    const ownMessage = message.sender_id === userId;
    const article = makeElement('article', `portal-chat-message${ownMessage ? ' is-own' : ''}`);
    const header = makeElement('div', 'portal-chat-message-meta');
    header.append(
        makeElement('strong', '', ownMessage ? 'You' : otherLabel),
        makeElement('time', '', formatTime(message.created_at))
    );
    article.append(header, makeElement('p', '', message.body));
    container.append(article);
}

async function loadOrderMessages(orderId, userId, container, status) {
    let data;
    let error;
    try {
        ({ data, error } = await supabase
            .from('order_messages')
            .select('id, sender_id, body, created_at')
            .eq('order_id', orderId)
            .order('created_at', { ascending: true })
            .limit(200));
    } catch (requestError) {
        error = requestError;
    }
    if (error) {
        console.error('Unable to load order messages.', error);
        showInlineStatus(status, `Messages could not be loaded: ${error.message || 'network error'}`, true);
        return;
    }
    data = data || [];
    container.replaceChildren();
    if (!data.length) container.append(makeElement('p', 'portal-chat-empty', 'No messages yet. Send the first message for this order.'));
    data.forEach(message => appendMessage(container, message, userId));
    container.scrollTop = container.scrollHeight;
}

async function loadSellerConversations() {
    const { data, error } = await supabase
        .from('seller_conversations')
        .select('id, buyer_id, seller_id, product_name, seller_name, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data || [];
}

function renderSellerConversationList(conversations, userId) {
    const section = makeElement('section', 'portal-seller-conversations');
    section.append(makeElement('h3', '', 'Product questions'));
    if (!conversations.length) {
        section.append(makeElement('p', 'portal-callout', 'Product questions you send or receive will appear here.'));
        return section;
    }
    const list = makeElement('div', 'portal-live-order-list');
    conversations.forEach(conversation => {
        const link = makeElement('a', 'portal-live-order');
        link.href = `${appRoot}pages/messages/conversation.html?conversation=${encodeURIComponent(conversation.id)}`;
        const summary = makeElement('span', '');
        const otherParty = conversation.buyer_id === userId ? conversation.seller_name : 'Buyer';
        summary.append(
            makeElement('strong', '', conversation.product_name),
            makeElement('small', '', `${otherParty} · ${formatTime(conversation.updated_at)}`)
        );
        link.append(summary, makeElement('span', 'portal-card-link', 'Open →'));
        list.append(link);
    });
    section.append(list);
    return section;
}

async function loadSellerMessages(conversationId, userId, container, status, otherLabel) {
    let data;
    let error;
    try {
        ({ data, error } = await supabase
            .from('seller_messages')
            .select('id, sender_id, body, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(200));
    } catch (requestError) {
        error = requestError;
    }
    if (error) {
        console.error('Unable to load seller messages.', error);
        showInlineStatus(status, `Messages could not be loaded: ${error.message || 'network error'}`, true);
        return;
    }
    container.replaceChildren();
    if (!data?.length) container.append(makeElement('p', 'portal-chat-empty', 'No messages yet. Ask the seller a question about this product.'));
    data?.forEach(message => appendMessage(container, message, userId, otherLabel));
    container.scrollTop = container.scrollHeight;
}

async function setupSellerConversation(conversationId) {
    if (!uuidPattern.test(conversationId)) {
        showNotice('The conversation reference is not valid.');
        return;
    }
    const { data: conversation, error } = await supabase
        .from('seller_conversations')
        .select('id, buyer_id, seller_id, product_id, product_name, seller_name')
        .eq('id', conversationId)
        .maybeSingle();
    if (error) throw error;
    if (!conversation) {
        showNotice('This product conversation is unavailable to your account.');
        return;
    }
    const isBuyer = conversation.buyer_id === currentUser.id;
    const isSeller = conversation.seller_id === currentUser.id;
    if (!isBuyer && !isSeller) {
        showNotice('This product conversation is unavailable to your account.');
        return;
    }
    const otherLabel = isBuyer ? conversation.seller_name : 'Buyer';
    const panel = makeElement('section', 'portal-live-chat');
    panel.setAttribute('aria-label', `Product conversation about ${conversation.product_name}`);
    const heading = makeElement('div', 'portal-live-chat-heading');
    heading.append(
        makeElement('div', ''),
        makeElement('span', 'portal-live-status', 'Connecting…')
    );
    heading.firstElementChild.append(
        makeElement('h3', '', conversation.product_name),
        makeElement('p', '', `Message ${otherLabel} about this product`)
    );
    const messageList = makeElement('div', 'portal-chat-list');
    messageList.setAttribute('role', 'log');
    messageList.setAttribute('aria-live', 'polite');
    const status = makeElement('p', 'portal-form-message');
    const form = document.createElement('form');
    form.className = 'portal-chat-compose';
    form.innerHTML = '<label for="sellerMessage">Message</label><textarea id="sellerMessage" maxlength="4000" required placeholder="Ask a question about this product"></textarea><button type="submit">Send message</button>';
    panel.append(heading, messageList, status, form);
    const backLink = makeElement('a', 'portal-card-link', 'Back to messages');
    backLink.href = `${appRoot}pages/messages/index.html`;
    pageContent.replaceChildren(panel, backLink);
    await loadSellerMessages(conversationId, currentUser.id, messageList, status, otherLabel);

    const channel = supabase
        .channel(`primus-seller-messages:${conversationId}:${currentUser.id}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'seller_messages',
            filter: `conversation_id=eq.${conversationId}`
        }, () => {
            void loadSellerMessages(conversationId, currentUser.id, messageList, status, otherLabel);
        })
        .subscribe(channelStatus => {
            const connection = panel.querySelector('.portal-live-status');
            if (connection) connection.textContent = channelStatus === 'SUBSCRIBED' ? 'Live' : channelStatus === 'CHANNEL_ERROR' ? 'Realtime unavailable' : 'Connecting…';
            if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
                showInlineStatus(status, 'Live updates are unavailable. Check that seller_messages is enabled in the Supabase Realtime publication.', true);
            }
        });
    activeRealtimeChannel = channel;

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const input = form.querySelector('textarea');
        const body = input.value.trim();
        if (!body) return;
        const button = form.querySelector('button');
        button.disabled = true;
        showInlineStatus(status, 'Sending…');
        try {
            const { error: sendError } = await supabase.from('seller_messages').insert({
                conversation_id: conversationId,
                sender_id: currentUser.id,
                body
            });
            if (sendError) throw sendError;
            input.value = '';
            showInlineStatus(status, 'Message sent.');
            await loadSellerMessages(conversationId, currentUser.id, messageList, status, otherLabel);
        } catch (sendError) {
            console.error('Unable to send a seller message.', sendError);
            showInlineStatus(status, `Message could not be sent: ${sendError.message || 'network error'}`, true);
        } finally {
            button.disabled = false;
        }
    });
}

function renderOrderList(orders, destination) {
    const list = makeElement('div', 'portal-live-order-list');
    if (!orders.length) {
        list.append(makeElement('p', 'portal-callout', 'No orders are available to this account yet.'));
        return list;
    }
    orders.forEach(order => {
        const link = makeElement('a', 'portal-live-order');
        link.href = `${appRoot}pages/${destination}?order=${encodeURIComponent(order.id)}`;
        const summary = makeElement('span', '');
        summary.append(
            makeElement('strong', '', orderLabel(order)),
            makeElement('small', '', `Status: ${order.status.replace(/_/g, ' ')}`)
        );
        link.append(summary, makeElement('span', 'portal-card-link', 'Open →'));
        list.append(link);
    });
    return list;
}

async function loadParticipantOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('id, status, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) throw error;
    return data || [];
}

function showSignInPrompt(featureName) {
    const card = makeElement('div', 'portal-cart-empty');
    card.append(
        makeElement('h3', '', 'Sign in to continue'),
        makeElement('p', '', `${featureName} is only available to authenticated order participants.`)
    );
    const link = makeElement('a', 'portal-action', 'Sign in');
    link.href = `${appRoot}pages/auth/login.html`;
    card.append(link);
    pageContent.replaceChildren(card);
}

async function setupMessages() {
    if (!liveMessageRoute) return;
    if (!currentUser) {
        showSignInPrompt('Order messages');
        return;
    }
    try {
        const requestedConversation = new URLSearchParams(window.location.search).get('conversation');
        if (route.endsWith('/conversation.html') && requestedConversation) {
            await setupSellerConversation(requestedConversation);
            return;
        }
        const orders = await loadParticipantOrders();
        const conversations = await loadSellerConversations();
        if (!route.endsWith('/conversation.html')) {
            pageContent.replaceChildren(
                makeElement('p', 'portal-callout', 'Order chats and product questions are private to the participants.'),
                makeElement('h3', '', 'Order conversations'),
                renderOrderList(orders, 'messages/conversation.html'),
                renderSellerConversationList(conversations, currentUser.id)
            );
            return;
        }
        const orderId = new URLSearchParams(window.location.search).get('order');
        if (!orderId || !uuidPattern.test(orderId)) {
            pageContent.replaceChildren(
                makeElement('p', 'portal-callout', 'Choose an order to open its private conversation.'),
                makeElement('h3', '', 'Order conversations'),
                renderOrderList(orders, 'messages/conversation.html'),
                renderSellerConversationList(conversations, currentUser.id)
            );
            return;
        }
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, status')
            .eq('id', orderId)
            .maybeSingle();
        if (orderError) throw orderError;
        if (!order) {
            showNotice('This order is unavailable to your account.');
            return;
        }
        const panel = makeElement('section', 'portal-live-chat');
        panel.setAttribute('aria-label', `Conversation for ${orderLabel(order)}`);
        const heading = makeElement('div', 'portal-live-chat-heading');
        heading.append(makeElement('h3', '', orderLabel(order)), makeElement('span', 'portal-live-status', 'Connecting…'));
        const messageList = makeElement('div', 'portal-chat-list');
        messageList.setAttribute('role', 'log');
        messageList.setAttribute('aria-live', 'polite');
        const status = makeElement('p', 'portal-form-message');
        const form = document.createElement('form');
        form.className = 'portal-chat-compose';
        form.innerHTML = '<label for="supabaseMessage">Message</label><textarea id="supabaseMessage" maxlength="4000" required placeholder="Write a message about this order"></textarea><button type="submit">Send message</button>';
        panel.append(heading, messageList, status, form);
        pageContent.replaceChildren(panel);
        await loadOrderMessages(orderId, currentUser.id, messageList, status);
        const channel = supabase
            .channel(`primus-order-messages:${orderId}:${currentUser.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'order_messages',
                filter: `order_id=eq.${orderId}`
            }, () => {
                void loadOrderMessages(orderId, currentUser.id, messageList, status);
            })
            .subscribe(channelStatus => {
                const connection = panel.querySelector('.portal-live-status');
                if (connection) connection.textContent = channelStatus === 'SUBSCRIBED' ? 'Live' : channelStatus === 'CHANNEL_ERROR' ? 'Realtime unavailable' : 'Connecting…';
                if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
                    showInlineStatus(status, 'Live updates are unavailable. Check that order_messages is enabled in the Supabase Realtime publication.', true);
                }
            });
        activeRealtimeChannel = channel;
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const input = form.querySelector('textarea');
            const body = input.value.trim();
            if (!body) return;
            const button = form.querySelector('button');
            button.disabled = true;
            showInlineStatus(status, 'Sending…');
            try {
                const { error } = await supabase.from('order_messages').insert({
                    order_id: orderId,
                    sender_id: currentUser.id,
                    body
                });
                if (error) throw error;
                input.value = '';
                showInlineStatus(status, 'Message sent.');
                await loadOrderMessages(orderId, currentUser.id, messageList, status);
            } catch (error) {
                console.error('Unable to send an order message.', error);
                showInlineStatus(status, `Message could not be sent: ${error.message || 'network error'}`, true);
            } finally {
                button.disabled = false;
            }
        });
    } catch (error) {
        console.error('Unable to open Primus messages.', error);
        showNotice(`Messages are unavailable: ${error.message}`, 'portal-callout is-error');
    }
}

function renderLocationControls(orders, userId) {
    if (!orders.length) {
        showNotice('No active delivery is assigned to this rider account. Location sharing is unavailable until an order is assigned.');
        return;
    }
    const section = makeElement('section', 'portal-live-location');
    const heading = makeElement('div', '');
    heading.append(
        makeElement('p', 'portal-eyebrow', 'Rider location'),
        makeElement('h3', '', 'Share live location for an active delivery'),
        makeElement('p', '', 'Sharing starts only when you press the button and allow browser location access. Stop sharing any time; updates expire automatically if this page goes offline.')
    );
    const label = makeElement('label', 'portal-location-field', 'Active delivery');
    const select = document.createElement('select');
    select.id = 'activeDeliveryOrder';
    orders.forEach(order => {
        const option = document.createElement('option');
        option.value = order.id;
        option.textContent = `${orderLabel(order)} · ${order.status.replace(/_/g, ' ')}`;
        select.append(option);
    });
    label.append(select);
    const controls = makeElement('div', 'portal-location-actions');
    const startButton = makeElement('button', 'portal-action', 'Start live location sharing');
    startButton.type = 'button';
    startButton.id = 'startLiveLocation';
    const stopButton = makeElement('button', 'portal-location-stop', 'Stop sharing');
    stopButton.type = 'button';
    stopButton.id = 'stopLiveLocation';
    stopButton.hidden = true;
    const deliveredButton = makeElement('button', '', 'Mark delivered');
    deliveredButton.type = 'button';
    deliveredButton.id = 'markDeliveryDelivered';
    controls.append(startButton, stopButton, deliveredButton);
    const status = makeElement('p', 'portal-location-status');
    status.id = 'liveLocationStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Location is not being shared.';
    const mapLink = makeElement('a', 'portal-card-link', 'Open your current position in OpenStreetMap');
    mapLink.id = 'liveLocationMap';
    mapLink.hidden = true;
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    section.append(heading, label, controls, status, mapLink);
    pageContent.replaceChildren(section, makeElement('p', 'portal-callout', 'Location is shared only with participants of the selected order. No location history is retained.'));

    let lastSentAt = 0;
    let writeInProgress = false;
    const updateLocation = async position => {
        if (activeLocationWatch === null || !activeLocationOrderId) return;
        const now = Date.now();
        if (writeInProgress || now - lastSentAt < 10000) return;
        writeInProgress = true;
        lastSentAt = now;
        const orderId = activeLocationOrderId;
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        pendingLocationWrite = supabase.from('delivery_locations').upsert({
            order_id: orderId,
            rider_id: userId,
            latitude,
            longitude,
            accuracy_m: Math.round(position.coords.accuracy),
            is_sharing: true
        }, { onConflict: 'order_id,rider_id' });
        let error;
        try {
            ({ error } = await pendingLocationWrite);
        } catch (requestError) {
            error = requestError;
        }
        writeInProgress = false;
        if (error) {
            console.error('Unable to update the live delivery location.', error);
            await stopLocationSharing(`Location sharing stopped: ${error.message}`, true);
            return;
        }
        if (activeLocationOrderId !== orderId) return;
        status.textContent = `Live location is sharing for ${orderLabel(orders.find(order => order.id === orderId))}.`;
        mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
        mapLink.hidden = false;
    };

    stopLocationSharing = async (message = 'Location sharing stopped.', persist = true) => {
        const orderId = activeLocationOrderId;
        if (activeLocationWatch !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(activeLocationWatch);
        }
        activeLocationWatch = null;
        activeLocationOrderId = null;
        startButton.disabled = false;
        select.disabled = false;
        stopButton.hidden = true;
        mapLink.hidden = true;
        if (persist && orderId) {
            try {
                await pendingLocationWrite;
                const { error } = await supabase
                    .from('delivery_locations')
                    .update({ is_sharing: false })
                    .eq('order_id', orderId)
                    .eq('rider_id', userId);
                if (error) throw error;
            } catch (error) {
                console.error('Unable to stop sharing the saved delivery location.', error);
                showInlineStatus(status, `Sharing stopped on this device, but Supabase could not clear the last location: ${error.message || 'network error'}`, true);
                return;
            }
        }
        showInlineStatus(status, message);
    };

    startButton.addEventListener('click', () => {
        if (!navigator.geolocation) {
            showInlineStatus(status, 'This browser does not support location access.', true);
            return;
        }
        if (!window.isSecureContext) {
            showInlineStatus(status, 'Live location requires HTTPS or localhost.', true);
            return;
        }
        if (!select.value) {
            showInlineStatus(status, 'Choose an assigned delivery first.', true);
            return;
        }
        activeLocationOrderId = select.value;
        lastSentAt = 0;
        startButton.disabled = true;
        select.disabled = true;
        stopButton.hidden = false;
        showInlineStatus(status, 'Waiting for browser location permission…');
        activeLocationWatch = navigator.geolocation.watchPosition(updateLocation, error => {
            const reasons = {
                1: 'Location permission was denied. Sharing has stopped.',
                2: 'The device could not determine a location. Sharing has stopped.',
                3: 'The location request timed out. Sharing has stopped.'
            };
            void stopLocationSharing(reasons[error.code] || 'Unable to read location. Sharing has stopped.');
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    });
    stopButton.addEventListener('click', () => {
        void stopLocationSharing();
    });
    deliveredButton.addEventListener('click', async () => {
        deliveredButton.disabled = true;
        try {
            if (activeLocationWatch !== null) await stopLocationSharing('Location sharing stopped for the completed delivery.');
            const { error } = await supabase.rpc('mark_order_delivered', { p_order_id: select.value });
            if (error) throw error;
            const selectedOrder = orders.find(order => order.id === select.value);
            if (selectedOrder) selectedOrder.status = 'delivered';
            status.textContent = `${orderLabel(selectedOrder)} marked delivered. The buyer's 3-day return period starts now.`;
            deliveredButton.remove();
            startButton.disabled = true;
            select.disabled = true;
        } catch (error) {
            console.error('Unable to mark this order delivered.', error);
            showInlineStatus(status, `Delivery could not be completed: ${error.message || 'network error'}`, true);
            deliveredButton.disabled = false;
        }
    });
    select.addEventListener('change', () => {
        if (activeLocationWatch !== null) void stopLocationSharing('Delivery changed. Location sharing stopped.');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && activeLocationWatch !== null) {
            void stopLocationSharing('Sharing stopped because this page is no longer visible.');
        }
    });
    window.addEventListener('pagehide', () => {
        if (activeLocationWatch !== null) void stopLocationSharing('Sharing stopped when the page closed.');
    });
}

async function setupRiderLocation() {
    if (!riderLocationRoute) return;
    if (!currentUser) {
        showSignInPrompt('Rider location sharing');
        return;
    }
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', currentUser.id)
        .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== 'rider') {
        showNotice('Live location sharing is available only to accounts approved as riders.');
        return;
    }
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, status, created_at')
        .eq('rider_id', currentUser.id)
        .eq('status', 'out_for_delivery')
        .order('created_at', { ascending: false });
    if (error) throw error;
    renderLocationControls(orders || [], currentUser.id);
}

function renderTrackingLocation(order, location) {
    const card = makeElement('section', 'portal-tracking-location');
    card.append(makeElement('h3', '', orderLabel(order)));
    card.append(makeElement('p', 'portal-tracking-status', `Order status: ${order.status.replace(/_/g, ' ')}`));
    if (!location || location.latitude === null || location.longitude === null) {
        card.append(makeElement('p', 'portal-callout', 'No current rider location is being shared. The rider must start sharing for this order; stopped or expired locations are not shown.'));
        return card;
    }
    const latitude = Number(location.latitude).toFixed(5);
    const longitude = Number(location.longitude).toFixed(5);
    card.append(makeElement('p', '', `Last location update: ${formatTime(location.updated_at)} · Accuracy about ${Math.round(location.accuracy_m || 0)} m`));
    card.append(makeElement('p', 'portal-tracking-coordinates', `Current GPS position: ${latitude}, ${longitude}`));
    const mapLink = makeElement('a', 'portal-action', 'Open live position in OpenStreetMap');
    mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    card.append(mapLink);
    return card;
}

async function loadOrderLocation(order, container, status) {
    let location;
    let error;
    try {
        ({ data: location, error } = await supabase
            .from('delivery_locations')
            .select('latitude, longitude, accuracy_m, updated_at, expires_at')
            .eq('order_id', order.id)
            .eq('is_sharing', true)
            .gt('expires_at', new Date().toISOString())
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle());
    } catch (requestError) {
        error = requestError;
    }
    if (error) {
        console.error('Unable to load the live delivery location.', error);
        showInlineStatus(status, `Location could not be loaded: ${error.message || 'network error'}`, true);
        return;
    }
    container.replaceChildren(renderTrackingLocation(order, location));
}

async function setupCustomerTracking() {
    if (!customerTrackingRoute) return;
    if (!currentUser) {
        showSignInPrompt('Delivery tracking');
        return;
    }
    try {
        const orders = await loadParticipantOrders();
        const requestedId = new URLSearchParams(window.location.search).get('order');
        if (!requestedId) {
            pageContent.replaceChildren(
                makeElement('p', 'portal-callout', 'Choose an order to view its delivery status and any rider location shared for that order.'),
                renderOrderList(orders, `${route.replace(/^pages\//, '')}`)
            );
            return;
        }
        if (!uuidPattern.test(requestedId)) {
            showNotice('The order reference is not valid.');
            return;
        }
        const { data: order, error } = await supabase
            .from('orders')
            .select('id, status')
            .eq('id', requestedId)
            .maybeSingle();
        if (error) throw error;
        if (!order) {
            showNotice('This order is unavailable to your account.');
            return;
        }
        const container = makeElement('div', 'portal-tracking-results');
        const status = makeElement('p', 'portal-form-message');
        status.textContent = 'Live location refreshes every 15 seconds and expires automatically.';
        pageContent.replaceChildren(status, container);
        await loadOrderLocation(order, container, status);
        let refreshInProgress = false;
        const refreshLocation = async () => {
            if (refreshInProgress) return;
            refreshInProgress = true;
            try {
                await loadOrderLocation(order, container, status);
            } finally {
                refreshInProgress = false;
            }
        };
        const refreshTimer = window.setInterval(() => void refreshLocation(), 15000);
        window.addEventListener('pagehide', () => window.clearInterval(refreshTimer), { once: true });
        const channel = supabase
            .channel(`primus-delivery-location:${order.id}:${currentUser.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'delivery_locations',
                filter: `order_id=eq.${order.id}`
            }, () => {
                void refreshLocation();
            })
            .subscribe(channelStatus => {
                if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
                    showInlineStatus(status, 'Live updates are unavailable. Check that delivery_locations is enabled in the Supabase Realtime publication.', true);
                }
            });
        activeRealtimeChannel = channel;
    } catch (error) {
        console.error('Unable to open delivery tracking.', error);
        showNotice(`Delivery tracking is unavailable: ${error.message}`, 'portal-callout is-error');
    }
}

async function initialize() {
    const config = window.PRIMUS_SUPABASE_CONFIG;
    if (!config || !config.url || !config.publishableKey) {
        setBackendSetupNotice();
        return;
    }
    if (isServiceRoleKey(config.publishableKey)) {
        showBackendInitializationError('Do not put a Supabase service-role or secret key in the browser. Use the publishable key.');
        console.error('A Supabase service-role or secret key must never be exposed in a browser.');
        return;
    }
    try {
        const projectUrl = new URL(config.url);
        if (projectUrl.protocol !== 'https:' && projectUrl.hostname !== 'localhost' && projectUrl.hostname !== '127.0.0.1') {
            throw new TypeError('The Supabase URL must use HTTPS.');
        }
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        supabase = createClient(config.url, config.publishableKey, {
            auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
        });
    } catch (error) {
        console.error('Unable to initialize the Primus Supabase client.', error);
        if (backendUiRoute) showBackendInitializationError(`Supabase could not be initialized: ${error.message}`);
        return;
    }

    window.PRIMUS_SUPABASE = supabase;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Unable to read the Supabase session.', error);
        if (backendUiRoute) showBackendInitializationError(`Your Supabase session could not be loaded: ${error.message}`);
        return;
    }
    currentUser = data.session ? data.session.user : null;
    updateNavigationUser(currentUser);
    if (currentUser) void refreshNavigationProfile(currentUser);
    const featureStatus = document.querySelector('.portal-main-heading .portal-status');
    if (featureStatus) featureStatus.textContent = 'Supabase configured';
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        currentUser = session ? session.user : null;
        updateNavigationUser(currentUser);
        if (currentUser) {
            const user = currentUser;
            window.setTimeout(() => {
                if (currentUser?.id === user.id) void refreshNavigationProfile(user);
            }, 0);
        }
        if (!currentUser && activeLocationWatch !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(activeLocationWatch);
            activeLocationWatch = null;
            activeLocationOrderId = null;
        }
    });
    window.addEventListener('pagehide', () => {
        if (activeRealtimeChannel) void supabase.removeChannel(activeRealtimeChannel);
        authListener.subscription.unsubscribe();
    }, { once: true });

    const signOutButton = document.getElementById('siteAccountSignOut');
    signOutButton?.addEventListener('click', async () => {
        const status = document.getElementById('siteAccountStatus');
        signOutButton.disabled = true;
        if (status) {
            status.hidden = true;
            status.textContent = '';
        }
        try {
            const { error: signOutError } = await supabase.auth.signOut();
            if (signOutError) throw signOutError;
            window.location.href = `${appRoot}index.html`;
        } catch (signOutError) {
            console.error('Unable to sign out of Primus.', signOutError);
            if (status) {
                status.textContent = `Sign out failed: ${signOutError.message}`;
                status.hidden = false;
            }
            signOutButton.disabled = false;
        }
    });

    setupAuthForm();
    try {
        await setupMessages();
        await setupRiderLocation();
        await setupCustomerTracking();
    } catch (featureError) {
        console.error('A Primus Supabase feature failed to initialize.', featureError);
        if (liveFeatureRoute) showNotice(`This feature could not be initialized: ${featureError.message}`, 'portal-callout is-error');
    }
    return supabase;
}

window.PRIMUS_SUPABASE_READY = initialize();
