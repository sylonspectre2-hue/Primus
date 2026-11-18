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

async function restRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!supabaseUrl || !serviceRoleKey) throw new Error('The payment service is not configured.');
    const headers = new Headers(init.headers);
    headers.set('apikey', serviceRoleKey);
    headers.set('Authorization', `Bearer ${serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
    if (!response.ok) throw new Error('Unable to update the protected payment records.');
    if (response.status === 204) return null;
    return responseJson(response);
}

async function callRpc(name: string, body: JsonRecord): Promise<unknown> {
    return restRequest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
}

async function authorizeAdmin(request: Request): Promise<string> {
    if (!supabaseUrl || !anonKey) throw new Error('The payment service is not configured.');
    const authorization = request.headers.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) throw new Error('Sign in as the Primus administrator.');
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: authorization }
    });
    if (!response.ok) throw new Error('Your session has expired. Sign in and try again.');
    const user = jsonRecord(await responseJson(response), 'Authentication service');
    const id = typeof user.id === 'string' ? user.id : '';
    if (!id) throw new Error('The signed-in account could not be verified.');

    const query = new URLSearchParams({ select: 'role', id: `eq.${id}`, limit: '1' });
    const profiles = await restRequest(`profiles?${query.toString()}`);
    if (!Array.isArray(profiles) || !profiles[0] || profiles[0].role !== 'admin') {
        throw new Error('Only the Primus administrator can run payment operations.');
    }
    return id;
}

function requiredString(value: unknown, label: string, maximum = 200): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
        throw new Error(`${label} is invalid.`);
    }
    return value.trim();
}

function rpcRow(value: unknown, label: string): JsonRecord {
    const rows = Array.isArray(value) ? value : [value];
    if (!rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
        throw new Error(`${label} returned no operation.`);
    }
    return rows[0] as JsonRecord;
}

function refundState(status: unknown): 'pending' | 'succeeded' | 'failed' {
    const normalized = String(status || '').toLowerCase();
    if (['completed-momo', 'completed-bank-transfer', 'completed-mpgs', 'completed-preauth'].includes(normalized)) return 'succeeded';
    if (normalized.includes('failed') || normalized.includes('cancelled')) return 'failed';
    return 'pending';
}

function transferState(status: unknown): 'pending' | 'paid' | 'failed' {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'SUCCESSFUL') return 'paid';
    if (normalized === 'FAILED' || normalized === 'REVERSED') return 'failed';
    return 'pending';
}

async function recordRefund(
    requestId: string,
    refundId: string,
    reference: string,
    status: 'pending' | 'succeeded' | 'failed' | 'unknown',
    failureMessage = ''
) {
    await callRpc('record_flutterwave_return_refund', {
        p_request_id: requestId,
        p_refund_id: refundId,
        p_reference: reference,
        p_status: status,
        p_failure_message: failureMessage.slice(0, 500)
    });
}

async function recordTransfer(
    settlementId: string,
    transferId: string,
    status: 'pending' | 'paid' | 'failed' | 'unknown',
    failureMessage = ''
) {
    await callRpc('record_flutterwave_seller_transfer', {
        p_settlement_id: settlementId,
        p_transfer_id: transferId,
        p_status: status,
        p_failure_message: failureMessage.slice(0, 500)
    });
}

async function initiateRefund(requestId: string) {
    if (!flutterwaveSecretKey) throw new Error('Flutterwave is not configured.');
    const operation = rpcRow(await callRpc('claim_flutterwave_return_refund', { p_request_id: requestId }), 'Refund request');
    const transactionId = requiredString(operation.transaction_id, 'Original transaction ID', 32);
    const amount = Number(operation.refund_amount_ugx);
    if (!/^[0-9]+$/.test(transactionId) || !Number.isSafeInteger(amount) || amount <= 0) {
        await recordRefund(requestId, '', '', 'failed', 'The original transaction or refund amount is invalid.');
        throw new Error('The original transaction or refund amount is invalid.');
    }

    let response: Response;
    try {
        response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/refund`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${flutterwaveSecretKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, comments: `Primus return ${requestId}` })
        });
    } catch (error) {
        await recordRefund(requestId, '', '', 'unknown', 'Flutterwave response was not received; reconcile before retrying.');
        console.error('Flutterwave refund request outcome is unknown.', error);
        return { status: 'unknown', message: 'Flutterwave did not confirm the refund request. Reconcile it in the provider dashboard before retrying.' };
    }

    let result: JsonRecord;
    try {
        result = jsonRecord(await responseJson(response), 'Flutterwave');
    } catch (error) {
        await recordRefund(requestId, '', '', 'unknown', 'Flutterwave returned an unreadable response; reconcile before retrying.');
        console.error('Unable to read the Flutterwave refund response.', error);
        return { status: 'unknown', message: 'Flutterwave returned an unreadable response. Reconcile it in the provider dashboard before retrying.' };
    }
    const data = result.data && typeof result.data === 'object' ? result.data as JsonRecord : {};
    if (!response.ok || result.status !== 'success') {
        await recordRefund(requestId, '', '', 'failed', 'Flutterwave rejected the refund request.');
        throw new Error('Flutterwave rejected the refund request. Review the provider response and balance.');
    }
    const refundId = String(data.id || '');
    const reference = typeof data.flw_ref === 'string' ? data.flw_ref : '';
    if (!/^[0-9]+$/.test(refundId)) {
        await recordRefund(requestId, '', reference, 'unknown', 'Flutterwave did not return a refund ID; reconcile before retrying.');
        return { status: 'unknown', message: 'Flutterwave may have accepted the refund but returned no refund ID. Reconcile before retrying.' };
    }
    const status = refundState(data.status);
    await recordRefund(requestId, refundId, reference, status);
    return {
        status,
        message: status === 'succeeded'
            ? 'Flutterwave confirmed the refund.'
            : 'Refund initiated; it will be marked complete only after Flutterwave confirms final payout.',
        reference
    };
}

async function verifyRefund(requestId: string) {
    if (!flutterwaveSecretKey) throw new Error('Flutterwave is not configured.');
    const query = new URLSearchParams({
        select: 'id,automated_refund_status,flutterwave_refund_id,flutterwave_refund_reference',
        id: `eq.${requestId}`,
        limit: '1'
    });
    const requests = await restRequest(`return_requests?${query.toString()}`);
    if (!Array.isArray(requests) || !requests[0]) throw new Error('Return request not found.');
    const refundId = requiredString(requests[0].flutterwave_refund_id, 'Flutterwave refund ID', 32);
    if (!/^[0-9]+$/.test(refundId)) throw new Error('This refund has no provider ID to verify; reconcile it in the Flutterwave dashboard.');

    const response = await fetch(`https://api.flutterwave.com/v3/refunds/${encodeURIComponent(refundId)}`, {
        headers: { Authorization: `Bearer ${flutterwaveSecretKey}` }
    });
    const result = jsonRecord(await responseJson(response), 'Flutterwave');
    if (!response.ok) throw new Error('Flutterwave could not verify this refund. Try again later.');
    const data = result.data && typeof result.data === 'object' ? result.data as JsonRecord : result;
    const status = refundState(data.status);
    await recordRefund(
        requestId,
        refundId,
        typeof data.flw_ref === 'string' ? data.flw_ref : String(requests[0].flutterwave_refund_reference || ''),
        status
    );
    return { status, message: status === 'succeeded' ? 'Flutterwave confirmed the refund.' : `Refund status: ${String(data.status || 'pending')}.` };
}

async function initiateTransfer(settlementId: string) {
    if (!flutterwaveSecretKey) throw new Error('Flutterwave is not configured.');
    const operation = rpcRow(
        await callRpc('claim_flutterwave_seller_transfer', { p_settlement_id: settlementId }),
        'Seller settlement'
    );
    const network = requiredString(operation.network, 'Payout network', 12);
    const phone = requiredString(operation.phone_number, 'Payout phone number', 20);
    const beneficiary = requiredString(operation.beneficiary_name, 'Beneficiary name', 120);
    const reference = requiredString(operation.transfer_reference, 'Transfer reference', 100);
    const amount = Number(operation.amount_ugx);
    if (!['MTN', 'AIRTEL'].includes(network) || !/^2567[0-9]{8}$/.test(phone) || !Number.isSafeInteger(amount) || amount <= 0) {
        await recordTransfer(settlementId, '', 'failed', 'The verified payout destination or amount is invalid.');
        throw new Error('The verified payout destination or amount is invalid.');
    }

    let response: Response;
    try {
        response = await fetch('https://api.flutterwave.com/v3/transfers', {
            method: 'POST',
            headers: { Authorization: `Bearer ${flutterwaveSecretKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                account_bank: network,
                account_number: phone,
                amount,
                currency: 'UGX',
                beneficiary_name: beneficiary,
                reference,
                narration: 'Primus seller settlement'
            })
        });
    } catch (error) {
        await recordTransfer(settlementId, '', 'unknown', 'Flutterwave response was not received; reconcile before retrying.');
        console.error('Flutterwave transfer request outcome is unknown.', error);
        return { status: 'unknown', message: 'Flutterwave did not confirm the transfer request. Reconcile it by reference before retrying.', reference };
    }

    let result: JsonRecord;
    try {
        result = jsonRecord(await responseJson(response), 'Flutterwave');
    } catch (error) {
        await recordTransfer(settlementId, '', 'unknown', 'Flutterwave returned an unreadable response; reconcile before retrying.');
        console.error('Unable to read the Flutterwave transfer response.', error);
        return { status: 'unknown', message: 'Flutterwave returned an unreadable response. Reconcile it by reference before retrying.', reference };
    }
    const data = result.data && typeof result.data === 'object' ? result.data as JsonRecord : {};
    if (!response.ok || result.status !== 'success') {
        await recordTransfer(settlementId, '', 'failed', 'Flutterwave rejected the transfer request.');
        throw new Error('Flutterwave rejected the transfer request. Review provider balance and payout details.');
    }
    const transferId = String(data.id || '');
    if (!/^[0-9]+$/.test(transferId)) {
        await recordTransfer(settlementId, '', 'unknown', 'Flutterwave did not return a transfer ID; reconcile before retrying.');
        return { status: 'unknown', message: 'Flutterwave may have accepted the transfer but returned no transfer ID. Reconcile it by reference before retrying.', reference };
    }
    const status = transferState(data.status);
    await recordTransfer(settlementId, transferId, status);
    return {
        status,
        message: status === 'paid' ? 'Flutterwave confirmed the seller transfer.' : 'Transfer submitted; verify its final status before treating it as paid.',
        reference
    };
}

async function verifyTransfer(settlementId: string) {
    if (!flutterwaveSecretKey) throw new Error('Flutterwave is not configured.');
    const query = new URLSearchParams({
        select: 'id,status,transfer_id,transfer_reference',
        id: `eq.${settlementId}`,
        limit: '1'
    });
    const settlements = await restRequest(`seller_settlements?${query.toString()}`);
    if (!Array.isArray(settlements) || !settlements[0]) throw new Error('Seller settlement not found.');
    const transferId = requiredString(settlements[0].transfer_id, 'Flutterwave transfer ID', 32);
    if (!/^[0-9]+$/.test(transferId)) throw new Error('This transfer has no provider ID; reconcile it by reference in the Flutterwave dashboard.');

    const response = await fetch(`https://api.flutterwave.com/v3/transfers/${encodeURIComponent(transferId)}`, {
        headers: { Authorization: `Bearer ${flutterwaveSecretKey}` }
    });
    const result = jsonRecord(await responseJson(response), 'Flutterwave');
    if (!response.ok || result.status !== 'success') throw new Error('Flutterwave could not verify this transfer. Try again later.');
    const data = result.data && typeof result.data === 'object' ? result.data as JsonRecord : {};
    const status = transferState(data.status);
    await recordTransfer(settlementId, transferId, status);
    return { status, message: status === 'paid' ? 'Flutterwave confirmed the seller transfer.' : `Transfer status: ${String(data.status || 'pending')}.` };
}

Deno.serve(async request => {
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') {
        return cors
            ? new Response('ok', { headers: cors })
            : new Response('Origin not allowed', { status: 403 });
    }
    if (!cors) return new Response('Origin not allowed', { status: 403 });
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, cors);

    try {
        await authorizeAdmin(request);
        const body = jsonRecord(await request.json(), 'Request');
        const action = requiredString(body.action, 'Payment action', 30);
        const id = requiredString(body.id, 'Payment operation ID', 64);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
            throw new Error('Payment operation ID is invalid.');
        }

        let result: JsonRecord;
        if (action === 'refund') result = await initiateRefund(id);
        else if (action === 'verify_refund') result = await verifyRefund(id);
        else if (action === 'transfer') result = await initiateTransfer(id);
        else if (action === 'verify_transfer') result = await verifyTransfer(id);
        else throw new Error('Unsupported payment action.');
        return jsonResponse(result, result.status === 'unknown' ? 202 : 200, cors);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Payment operation failed.';
        console.error('Flutterwave payout operation failed:', error);
        return jsonResponse({ error: message }, 400, cors);
    }
});
