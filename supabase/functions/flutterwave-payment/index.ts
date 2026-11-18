const supabaseUrl = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const flutterwaveSecretKey = Deno.env.get('FLW_SECRET_KEY');
const siteUrl = Deno.env.get('SITE_URL');

type JsonRecord = Record<string, unknown>;

const corsHeaders = (origin: string | null) => {
    const configuredOrigin = siteUrl ? new URL(siteUrl).origin : '';
    const localOrigin = origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    return origin && (origin === configuredOrigin || localOrigin)
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Vary': 'Origin'
        }
        : null;
};

function jsonResponse(body: JsonRecord, status: number, cors: Record<string, string>) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' }
    });
}

async function responseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        throw new Error('A payment service returned an unreadable response.');
    }
}

function jsonRecord(value: unknown, label: string): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} returned an invalid response.`);
    }
    return value as JsonRecord;
}

function requiredString(value: unknown, label: string, maximum = 200): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
        throw new Error(`${label} is invalid.`);
    }
    return value.trim();
}

function parseAttempts(value: unknown): JsonRecord[] {
    if (!Array.isArray(value)) throw new Error('Could not read the payment attempt.');
    return value.filter((row): row is JsonRecord => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

async function restRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!supabaseUrl || !serviceRoleKey) throw new Error('The payment service is not configured.');
    const headers = new Headers(init.headers);
    headers.set('apikey', serviceRoleKey);
    headers.set('Authorization', `Bearer ${serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers
    });
    if (!response.ok) throw new Error('Unable to update payment records.');
    if (response.status === 204) return null;
    return responseJson(response);
}

async function getAttempts(reference: string, buyerId: string): Promise<JsonRecord[]> {
    const query = new URLSearchParams({
        select: 'id,order_id,buyer_id,provider_reference,provider_transaction_id,amount_ugx,status',
        provider: 'eq.flutterwave',
        provider_reference: `eq.${reference}`,
        buyer_id: `eq.${buyerId}`
    });
    return parseAttempts(await restRequest(`payment_attempts?${query.toString()}`));
}

function orderIdsFor(attempts: JsonRecord[]): string[] {
    const ids = attempts.map(attempt => attempt.order_id);
    return ids.map(id => {
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
            throw new Error('The payment is not linked to valid orders.');
        }
        return id;
    });
}

function amountFor(attempts: JsonRecord[]): number {
    const amount = attempts.reduce((total, attempt) => total + Number(attempt.amount_ugx), 0);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('The order total is invalid.');
    return amount;
}

async function claimPendingPayment(reference: string, buyerId: string, orderIds: string[], expectedCount: number): Promise<boolean> {
    const attemptQuery = new URLSearchParams({
        provider: 'eq.flutterwave',
        provider_reference: `eq.${reference}`,
        buyer_id: `eq.${buyerId}`,
        status: 'eq.pending'
    });
    const claimed = parseAttempts(await restRequest(`payment_attempts?${attemptQuery.toString()}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'processing', updated_at: new Date().toISOString() })
    }));
    if (claimed.length !== expectedCount) return false;

    const orderQuery = new URLSearchParams({
        buyer_id: `eq.${buyerId}`,
        id: `in.(${orderIds.join(',')})`
    });
    await restRequest(`orders?${orderQuery.toString()}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'processing' })
    });
    return true;
}

async function updatePaymentRecords(
    reference: string,
    buyerId: string,
    orderIds: string[],
    attemptUpdates: JsonRecord,
    orderUpdates: JsonRecord
): Promise<void> {
    const attemptQuery = new URLSearchParams({
        provider: 'eq.flutterwave',
        provider_reference: `eq.${reference}`,
        buyer_id: `eq.${buyerId}`
    });
    await restRequest(`payment_attempts?${attemptQuery.toString()}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...attemptUpdates, updated_at: new Date().toISOString() })
    });
    const orderQuery = new URLSearchParams({
        buyer_id: `eq.${buyerId}`,
        id: `in.(${orderIds.join(',')})`
    });
    await restRequest(`orders?${orderQuery.toString()}`, {
        method: 'PATCH',
        body: JSON.stringify(orderUpdates)
    });
}

async function authorizeUser(request: Request): Promise<JsonRecord> {
    if (!supabaseUrl || !anonKey) throw new Error('The payment service is not configured.');
    const authorization = request.headers.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) throw new Error('Sign in before paying.');
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: authorization }
    });
    if (!response.ok) throw new Error('Your session has expired. Sign in and try again.');
    return jsonRecord(await responseJson(response), 'Authentication service');
}

async function initiatePayment(
    user: JsonRecord,
    reference: string,
    network: string,
    phoneNumber: string,
    fullName: string,
    attempts: JsonRecord[]
): Promise<JsonRecord> {
    if (!flutterwaveSecretKey || !siteUrl) throw new Error('Flutterwave payments are not configured yet.');
    if (attempts.some(attempt => attempt.status === 'succeeded')) {
        return { status: 'paid', order_ids: orderIdsFor(attempts) };
    }
    if (attempts.some(attempt => attempt.status === 'failed' || attempt.status === 'cancelled')) {
        return { status: 'failed', message: 'This payment attempt has ended. Your reserved items have been released.' };
    }
    const existingTransaction = attempts.find(attempt => typeof attempt.provider_transaction_id === 'string')?.provider_transaction_id;
    if (existingTransaction) return { status: 'processing', tx_ref: reference };
    if (attempts.some(attempt => attempt.status === 'processing')) {
        return { status: 'unknown', message: 'The payment request may already be processing. Do not retry; contact support with your reference.' };
    }

    const amount = amountFor(attempts);
    const email = requiredString(user.email, 'Account email');
    const redirect = new URL('pages/checkout/processing.html', `${siteUrl.replace(/\/+$/, '')}/`);
    redirect.searchParams.set('tx_ref', reference);
    const orderIds = orderIdsFor(attempts);
    const claimed = await claimPendingPayment(reference, String(user.id), orderIds, attempts.length);
    if (!claimed) {
        return { status: 'unknown', message: 'Another payment request may already be running. Do not retry; contact support with your reference.' };
    }
    const providerResponse = await fetch('https://api.flutterwave.com/v3/charges?type=mobile_money_uganda', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${flutterwaveSecretKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            tx_ref: reference,
            amount: String(amount),
            currency: 'UGX',
            network,
            phone_number: phoneNumber,
            email,
            fullname: fullName,
            redirect_url: redirect.toString()
        })
    });
    const result = jsonRecord(await responseJson(providerResponse), 'Flutterwave');
    const data = result.data && typeof result.data === 'object' ? result.data as JsonRecord : {};
    if (!providerResponse.ok || result.status !== 'success') {
        await updatePaymentRecords(reference, String(user.id), orderIds, { status: 'failed' }, {
            payment_status: 'failed',
            status: 'cancelled'
        });
        return { status: 'failed', message: 'Flutterwave could not start this payment. Your reserved items have been released.' };
    }
    if (typeof data.id !== 'string' && typeof data.id !== 'number') {
        return { status: 'unknown', message: 'Flutterwave may have started the payment but did not return a transaction ID. Do not retry; contact support with your payment reference.' };
    }
    await updatePaymentRecords(reference, String(user.id), orderIds, {
        status: 'processing',
        provider_transaction_id: String(data.id)
    }, { payment_status: 'processing' });
    return { status: 'processing', tx_ref: reference };
}

async function verifyPayment(
    reference: string,
    buyerId: string,
    attempts: JsonRecord[]
): Promise<JsonRecord> {
    if (!flutterwaveSecretKey) throw new Error('Flutterwave payments are not configured yet.');
    if (attempts.every(attempt => attempt.status === 'succeeded')) {
        return { status: 'paid', order_ids: orderIdsFor(attempts) };
    }
    const transactionIds = [...new Set(attempts.map(attempt => attempt.provider_transaction_id).filter(value => typeof value === 'string'))];
    if (transactionIds.length !== 1) return { status: 'processing', message: 'Waiting for Flutterwave to start the payment.' };

    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionIds[0]))}/verify`, {
        headers: { Authorization: `Bearer ${flutterwaveSecretKey}` }
    });
    const result = jsonRecord(await responseJson(response), 'Flutterwave');
    const transaction = result.data && typeof result.data === 'object' ? result.data as JsonRecord : {};
    if (!response.ok || result.status !== 'success') throw new Error('Flutterwave could not verify the payment yet. Try again shortly.');

    const orderIds = orderIdsFor(attempts);
    if (
        transaction.tx_ref !== reference
        || transaction.currency !== 'UGX'
        || Number(transaction.amount) !== amountFor(attempts)
    ) {
        throw new Error('The verified payment details do not match this order. Contact support before retrying.');
    }

    const providerStatus = String(transaction.status || '').toLowerCase();
    if (providerStatus === 'successful') {
        await updatePaymentRecords(reference, buyerId, orderIds, { status: 'succeeded' }, { payment_status: 'paid' });
        return { status: 'paid', order_ids: orderIds };
    }
    if (providerStatus === 'failed' || providerStatus === 'cancelled') {
        await updatePaymentRecords(reference, buyerId, orderIds, { status: providerStatus }, {
            payment_status: 'failed',
            status: 'cancelled'
        });
        return { status: 'failed', message: 'The payment was not completed. Your reserved items have been released.' };
    }
    return { status: 'processing', message: 'The payment is still processing. Approve the prompt on your phone, then check again.' };
}

Deno.serve(async request => {
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin);
    if (!cors) return new Response('Origin is not allowed.', { status: 403 });
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, cors);

    try {
        const user = await authorizeUser(request);
        const payload: unknown = await request.json();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return jsonResponse({ error: 'Invalid payment request.' }, 400, cors);
        }
        const input = payload as JsonRecord;
        const action = requiredString(input.action, 'Action', 20);
        const reference = requiredString(input.tx_ref, 'Payment reference', 60);
        if (!/^primus-[0-9a-f-]{36}$/i.test(reference)) {
            return jsonResponse({ error: 'Invalid payment reference.' }, 400, cors);
        }
        if (typeof user.id !== 'string') throw new Error('Your session could not be verified.');
        const attempts = await getAttempts(reference, user.id);
        if (!attempts.length) return jsonResponse({ error: 'Payment attempt not found.' }, 404, cors);

        if (action === 'initiate') {
            const network = requiredString(input.network, 'Mobile Money network', 12).toUpperCase();
            if (network !== 'MTN' && network !== 'AIRTEL') {
                return jsonResponse({ error: 'Choose MTN or Airtel Uganda.' }, 400, cors);
            }
            const enteredPhone = requiredString(input.phone_number, 'Phone number', 20).replace(/\D/g, '');
            const phoneNumber = enteredPhone.length === 10 && enteredPhone.startsWith('0')
                ? `256${enteredPhone.slice(1)}`
                : enteredPhone;
            if (!/^256\d{9}$/.test(phoneNumber)) {
                return jsonResponse({ error: 'Enter a valid Uganda Mobile Money number.' }, 400, cors);
            }
            const fullName = requiredString(input.fullname, 'Full name', 120);
            const result = await initiatePayment(user, reference, network, phoneNumber, fullName, attempts);
            return jsonResponse(result, 200, cors);
        }

        if (action === 'verify') {
            const result = await verifyPayment(reference, user.id, attempts);
            return jsonResponse(result, 200, cors);
        }
        return jsonResponse({ error: 'Unsupported payment action.' }, 400, cors);
    } catch (error) {
        console.error('Flutterwave payment request failed.', error);
        const message = error instanceof Error ? error.message : 'The payment request could not be completed.';
        const status = message.startsWith('Sign in') || message.startsWith('Your session') ? 401 : 400;
        return jsonResponse({ error: message }, status, cors);
    }
});
