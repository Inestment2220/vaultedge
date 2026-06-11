require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5500;
const PLISIO_KEY = process.env.PLISIO_SECRET_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const NGN_TO_USD = parseFloat(process.env.NGN_TO_USD) || 0.00065;
const TEST_MODE = process.env.TEST_MODE === 'true';
const INVOICES_FILE = path.join(__dirname, 'invoices.json');
const WITHDRAWALS_FILE = path.join(__dirname, 'withdrawals.json');
const USERS_FILE = path.join(__dirname, 'synced_users.json');
const PLISIO_BASE = 'https://api.plisio.net/api/v1';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════ FILE HELPERS ═══════
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback || {}; } }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function readInvoices() { return readJSON(INVOICES_FILE, {}); }
function writeInvoices(d) { writeJSON(INVOICES_FILE, d); }
function readWithdrawals() { return readJSON(WITHDRAWALS_FILE, {}); }
function writeWithdrawals(d) { writeJSON(WITHDRAWALS_FILE, d); }
function readUsers() { return readJSON(USERS_FILE, { users: [] }); }
function writeUsers(d) { writeJSON(USERS_FILE, d); }

const activeTokens = new Set();

function adminAuth(req, res, next) {
    const token = req.headers['x-admin-key'];
    if (!token || token.length < 32) return res.status(401).json({ status: 'error', message: 'Invalid or missing admin token' });
    next();
}

// ═══════ PLISIO API: GET REQUEST ═══════
function plisioGet(endpoint, params) {
    return new Promise((resolve, reject) => {
        const qp = new URLSearchParams({ ...params, api_key: PLISIO_KEY }).toString();
        const url = PLISIO_BASE + endpoint + '?' + qp;
        console.log('[PLISIO] GET', endpoint);

        const req = https.get(url, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 45000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.status === 'success') {
                        console.log('[PLISIO] SUCCESS:', endpoint);
                        resolve(json);
                    } else {
                        let errorMsg = json.err_msg || json.message || 'Unknown error';
                        if (json.data && typeof json.data === 'string') errorMsg = json.data;
                        else if (json.data && json.data.message) errorMsg = json.data.message;
                        console.error('[PLISIO] ERROR:', errorMsg);
                        reject({ message: errorMsg, code: 'PLISIO_ERROR' });
                    }
                } catch (e) {
                    console.error('[PLISIO] Parse error:', body.substring(0, 200));
                    reject({ message: 'Invalid JSON from Plisio', code: 'PARSE_ERROR' });
                }
            });
        });
        req.on('error', (e) => {
            console.error('[PLISIO] Network error:', e.message);
            reject({ message: 'Cannot connect to Plisio: ' + e.message, code: 'NETWORK_ERROR' });
        });
        req.setTimeout(45000, () => {
            req.destroy();
            reject({ message: 'Plisio API timed out', code: 'TIMEOUT' });
        });
    });
}

// ═══════ PLISIO API: POST REQUEST (FOR WITHDRAWALS) ═══════
function plisioPost(endpoint, params) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ ...params, api_key: PLISIO_KEY });
        const url = PLISIO_BASE + endpoint;
        console.log('[PLISIO] POST', endpoint);

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 45000
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.status === 'success') {
                        console.log('[PLISIO] POST SUCCESS:', endpoint);
                        resolve(json);
                    } else {
                        let errorMsg = json.err_msg || json.message || 'Unknown error';
                        if (json.data && typeof json.data === 'string') errorMsg = json.data;
                        else if (json.data && json.data.message) errorMsg = json.data.message;
                        console.error('[PLISIO] POST ERROR:', errorMsg);
                        reject({ message: errorMsg, code: 'PLISIO_ERROR' });
                    }
                } catch (e) {
                    console.error('[PLISIO] POST Parse error:', body.substring(0, 200));
                    reject({ message: 'Invalid JSON from Plisio', code: 'PARSE_ERROR' });
                }
            });
        });
        req.on('error', (e) => {
            console.error('[PLISIO] POST Network error:', e.message);
            reject({ message: 'Cannot connect to Plisio: ' + e.message, code: 'NETWORK_ERROR' });
        });
        req.setTimeout(45000, () => {
            req.destroy();
            reject({ message: 'Plisio API timed out', code: 'TIMEOUT' });
        });
        req.write(postData);
        req.end();
    });
}

function plisioReady() {
    if (!PLISIO_KEY || PLISIO_KEY.length < 10) return { ok: false, reason: 'PLISIO_SECRET_KEY missing' };
    if (PLISIO_KEY.includes('your_') || PLISIO_KEY.includes('PUT_YOUR')) return { ok: false, reason: 'Placeholder key' };
    if (TEST_MODE) return { ok: false, reason: 'TEST_MODE enabled' };
    return { ok: true };
}

// ═══════ TEST MODE SIMULATIONS ═══════
function simulateInvoice(params) {
    const cryptoMap = {
        USDT_TRX: { symbol: 'USDT', address: 'T' + crypto.randomBytes(34).toString('hex'), decimals: 6 },
        BTC: { symbol: 'BTC', address: 'bc1' + crypto.randomBytes(32).toString('hex'), decimals: 8 }
    };
    const currency = params.currency || 'USDT_TRX';
    const info = cryptoMap[currency] || cryptoMap['USDT_TRX'];
    const amount = parseFloat(params.source_amount) || 10;
    const cryptoAmount = currency === 'BTC' ? (amount / 60000).toFixed(info.decimals) : amount.toFixed(info.decimals);
    const txnId = 'TEST_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex').toUpperCase();
    console.log('[TEST] Simulated invoice:', txnId);
    return { txn_id: txnId, wallet_hash: info.address, invoice_url: '#', amount: cryptoAmount, currency: currency, expire_min: 30 };
}

function simulateWithdrawal(params) {
    const cryptoMap = { USDT_TRX: { symbol: 'USDT', decimals: 6 }, BTC: { symbol: 'BTC', decimals: 8 } };
    const currency = params.currency || 'USDT_TRX';
    const info = cryptoMap[currency] || cryptoMap['USDT_TRX'];
    const amount = parseFloat(params.source_amount) || 10;
    const cryptoAmount = currency === 'BTC' ? (amount / 60000).toFixed(info.decimals) : amount.toFixed(info.decimals);
    const txnId = 'TEST_WD_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex').toUpperCase();
    console.log('[TEST] Simulated withdrawal:', txnId);
    return { txn_id: txnId, amount: cryptoAmount };
}

// ═══════ USER SYNC ═══════
app.post('/api/sync-user', (req, res) => {
    try {
        const { name, email, phone, refCode, joined } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email required' });
        const db = readUsers();
        const idx = db.users.findIndex(u => u.email === email);
        if (idx >= 0) {
            db.users[idx].name = name || db.users[idx].name;
            db.users[idx].phone = phone || db.users[idx].phone;
            db.users[idx].refCode = refCode || db.users[idx].refCode;
            db.users[idx].lastSync = Date.now();
            if (joined && !db.users[idx].joined) db.users[idx].joined = joined;
        } else {
            db.users.push({ name: name || 'Unknown', email, phone: phone || '', refCode: refCode || '', joined: joined || Date.now(), registered: Date.now(), lastSync: Date.now() });
        }
        writeUsers(db);
        res.json({ status: 'success', message: 'User synced' });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════ HEALTH ═══════
app.get('/api/health', (req, res) => {
    const c = plisioReady();
    const u = readUsers();
    res.json({
        status: 'ok',
        plisio: { configured: c.ok, issue: c.ok ? null : c.reason, key_set: PLISIO_KEY.length > 0, key_length: PLISIO_KEY.length, key_prefix: PLISIO_KEY.substring(0, 8) + '...', is_placeholder: PLISIO_KEY.includes('your_') || PLISIO_KEY.includes('PUT_YOUR') },
        test_mode: TEST_MODE,
        port: PORT,
        total_users: u.users ? u.users.length : 0,
        admin_routes: true,
        environment: process.env.NODE_ENV || 'development'
    });
});

// ═══════ PLISIO WEBHOOK CALLBACK ═══════
app.post('/api/plisio-callback', (req, res) => {
    try {
        console.log('[CALLBACK] Received:', JSON.stringify(req.body).substring(0, 500));
        const { txn_id, status } = req.body;
        if (!txn_id) return res.status(400).json({ status: 'error', message: 'Missing txn_id' });
        const invoices = readInvoices();
        const invoice = invoices[txn_id];
        if (!invoice) {
            console.log('[CALLBACK] Invoice not found:', txn_id);
            return res.json({ status: 'success' });
        }
        const statusMap = { completed: 'paid', paid: 'paid', expired: 'expired', cancelled: 'expired', pending: 'pending' };
        const newStatus = statusMap[status] || status;
        if (invoice.status !== newStatus) {
            console.log('[CALLBACK] Updating', txn_id, invoice.status, '→', newStatus);
            invoices[txn_id].status = newStatus;
            invoices[txn_id].updated = Date.now();
            writeInvoices(invoices);
            if (newStatus === 'paid') console.log('[CALLBACK] PAID:', txn_id, 'for', invoice.email);
        }
        res.json({ status: 'success' });
    } catch (e) {
        console.error('[CALLBACK] Error:', e.message);
        res.json({ status: 'success' });
    }
});

// ═══════ ADMIN ROUTES ═══════
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ status: 'error', message: 'Password required' });
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.add(token);
    if (activeTokens.size > 20) { Array.from(activeTokens).slice(0, -20).forEach(t => activeTokens.delete(t)); }
    res.json({ status: 'success', data: { token } });
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
    try {
        const users = readUsers().users || [];
        const invoices = readInvoices();
        const withdrawals = readWithdrawals();
        let totalDepNGN = 0, totalDepUSD = 0, paidCount = 0, pendingCount = 0;
        let totalWdNGN = 0, totalWdUSD = 0, wdPending = 0;
        Object.values(invoices).forEach(inv => {
            if (inv.status === 'paid') { totalDepNGN += inv.amountNGN || 0; totalDepUSD += inv.amountUSD || 0; paidCount++; }
            else if (inv.status === 'pending') pendingCount++;
        });
        Object.values(withdrawals).forEach(wd => {
            totalWdNGN += wd.amountNGN || 0; totalWdUSD += wd.amountUSD || 0;
            if (wd.status === 'processing') wdPending++;
        });
        res.json({ status: 'success', data: { users: { total: users.length }, deposits: { totalNGN: totalDepNGN, totalUSD: totalDepUSD, paid: paidCount, pending: pendingCount }, withdrawals: { totalNGN: totalWdNGN, totalUSD: totalWdUSD, pending: wdPending }, profit: totalDepUSD - totalWdUSD } });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/api/admin/users', adminAuth, (req, res) => {
    try { res.json({ status: 'success', data: readUsers().users || [] }); }
    catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.delete('/api/admin/users/:email', adminAuth, (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        const db = readUsers();
        const before = db.users.length;
        db.users = db.users.filter(u => u.email !== email);
        if (db.users.length === before) return res.status(404).json({ status: 'error', message: 'User not found' });
        writeUsers(db);
        res.json({ status: 'success', message: 'User deleted' });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/api/admin/invoices', adminAuth, (req, res) => {
    try { res.json({ status: 'success', data: Object.values(readInvoices()).sort((a, b) => (b.created || 0) - (a.created || 0)) }); }
    catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.put('/api/admin/invoices/:txnId', adminAuth, (req, res) => {
    try {
        const { status } = req.body;
        if (!['paid', 'expired', 'pending'].includes(status)) return res.status(400).json({ status: 'error', message: 'Invalid status' });
        const invoices = readInvoices();
        if (!invoices[req.params.txnId]) return res.status(404).json({ status: 'error', message: 'Invoice not found' });
        invoices[req.params.txnId].status = status;
        invoices[req.params.txnId].updated = Date.now();
        writeInvoices(invoices);
        res.json({ status: 'success', message: 'Invoice updated' });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/api/admin/withdrawals', adminAuth, (req, res) => {
    try { res.json({ status: 'success', data: Object.values(readWithdrawals()).sort((a, b) => (b.created || 0) - (a.created || 0)) }); }
    catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.put('/api/admin/withdrawals/:id', adminAuth, (req, res) => {
    try {
        const { status } = req.body;
        if (!['completed', 'failed', 'processing'].includes(status)) return res.status(400).json({ status: 'error', message: 'Invalid status' });
        const withdrawals = readWithdrawals();
        if (!withdrawals[req.params.id]) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
        withdrawals[req.params.id].status = status;
        withdrawals[req.params.id].updated = Date.now();
        writeWithdrawals(withdrawals);
        res.json({ status: 'success', message: 'Withdrawal updated' });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════ CREATE INVOICE ═══════
app.post('/api/create-invoice', async (req, res) => {
    const { email, level, amountNGN, cryptoType } = req.body;
    if (!email || !level || !amountNGN || !cryptoType) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }
    const cryptoMap = { usdt: 'USDT_TRX', btc: 'BTC' };
    const plisioCurrency = cryptoMap[cryptoType];
    if (!plisioCurrency) return res.status(400).json({ status: 'error', message: 'Unsupported crypto type' });

    const usd = (parseFloat(amountNGN) * NGN_TO_USD).toFixed(2);
    if (parseFloat(usd) <= 0) return res.status(400).json({ status: 'error', message: 'Amount must be > 0' });

    const check = plisioReady();
    if (!check.ok && !TEST_MODE) {
        return res.status(503).json({ status: 'error', message: check.reason, code: 'PLISIO_NOT_READY' });
    }

    const orderNum = 'QM_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const plisioParams = {
        source_currency: 'USD',
        source_amount: usd,
        order_name: 'Qumovcoin Level ' + level,
        order_number: orderNum,
        currency: plisioCurrency,
        email: email,
        expire_min: '30'
    };

    console.log('[INVOICE] Creating:', { email, level, amountNGN, usd, plisioCurrency, testMode: TEST_MODE });

    try {
        let inv;
        if (TEST_MODE) {
            inv = simulateInvoice(plisioParams);
        } else {
            const result = await plisioGet('/invoices/new', plisioParams);
            if (!result.data) throw new Error('No data from Plisio');
            inv = result.data;
        }

        if (!inv || !inv.txn_id) throw new Error('Invalid invoice response');

        const invoices = readInvoices();
        invoices[inv.txn_id] = {
            txn_id: inv.txn_id,
            email,
            level: parseInt(level),
            amountNGN: parseFloat(amountNGN),
            amountUSD: parseFloat(usd),
            cryptoType,
            wallet_hash: inv.wallet_hash,
            invoice_url: inv.invoice_url || '',
            amount_crypto: inv.amount,
            currency: inv.currency || plisioCurrency,
            status: 'pending',
            test_mode: TEST_MODE,
            created: Date.now()
        };
        writeInvoices(invoices);

        console.log('[INVOICE] Created:', inv.txn_id);

        res.json({
            status: 'success',
            data: {
                txn_id: inv.txn_id,
                wallet_hash: inv.wallet_hash,
                invoice_url: inv.invoice_url || '',
                amount_crypto: inv.amount,
                currency: inv.currency || plisioCurrency,
                amount_usd: usd,
                expire_min: 30,
                test_mode: TEST_MODE
            }
        });
    } catch (error) {
        console.error('[INVOICE] ERROR:', error.message);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// ═══════ CHECK INVOICE STATUS ═══════
app.get('/api/invoice-status', async (req, res) => {
    const { txn_id } = req.query;
    if (!txn_id) return res.status(400).json({ status: 'error', message: 'Missing txn_id' });

    const invoices = readInvoices();
    const local = invoices[txn_id];
    if (!local) return res.status(404).json({ status: 'error', message: 'Invoice not found' });

    // Auto-confirm test mode after 10 seconds
    if (local.test_mode && local.status === 'pending' && Date.now() - local.created > 10000) {
        local.status = 'paid';
        local.updated = Date.now();
        writeInvoices(invoices);
    }

    // Check with Plisio if real mode
    if (!local.test_mode && plisioReady().ok) {
        try {
            const r = await plisioGet('/invoices/' + txn_id, {});
            if (r.data) {
                const ps = r.data.status === 'completed' ? 'paid' : r.data.status === 'expired' ? 'expired' : r.data.status;
                if (local.status !== ps) {
                    invoices[txn_id].status = ps;
                    invoices[txn_id].updated = Date.now();
                    writeInvoices(invoices);
                    if (ps === 'paid') console.log('[STATUS] CONFIRMED via Plisio:', txn_id);
                }
                return res.json({ status: 'success', data: { txn_id: r.data.txn_id, status: r.data.status, level: local.level, amountNGN: local.amountNGN, email: local.email } });
            }
        } catch (e) {
            console.log('[STATUS] Plisio check failed, using local:', e.message);
        }
    }

    res.json({
        status: 'success',
        data: {
            txn_id: local.txn_id,
            status: local.status === 'paid' ? 'completed' : local.status,
            level: local.level,
            amountNGN: local.amountNGN,
            email: local.email,
            test_mode: local.test_mode
        }
    });
});

// ═══════ WITHDRAW (USES POST - FIXED!) ═══════
app.post('/api/withdraw', async (req, res) => {
    const { email, amountNGN, cryptoType, walletAddress, userName } = req.body;

    if (!email || !amountNGN || !cryptoType || !walletAddress) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }
    if (parseFloat(amountNGN) <= 0) {
        return res.status(400).json({ status: 'error', message: 'Invalid amount' });
    }

    const cryptoMap = { usdt: 'USDT_TRX', btc: 'BTC' };
    const plisioCurrency = cryptoMap[cryptoType];
    if (!plisioCurrency) return res.status(400).json({ status: 'error', message: 'Unsupported crypto type' });

    const usd = (parseFloat(amountNGN) * NGN_TO_USD).toFixed(2);
    const wid = 'WD_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();

    console.log('[WITHDRAW] Creating:', { email, amountNGN, usd, plisioCurrency, wallet: walletAddress.substring(0, 20) + '...' });

    try {
        let result;

        if (TEST_MODE) {
            result = simulateWithdrawal({ source_currency: 'USD', source_amount: usd, currency: plisioCurrency });
        } else {
            // USE POST for withdrawals - this was the bug!
            const response = await plisioPost('/operations/withdraw', {
                source_currency: 'USD',
                source_amount: usd,
                currency: plisioCurrency,
                address: walletAddress,
                type: 'crypto'
            });

            if (!response.data) throw new Error('No data from Plisio withdrawal');
            result = response.data;
        }

        const withdrawals = readWithdrawals();
        withdrawals[wid] = {
            withdrawal_id: wid,
            plisio_txn_id: result.txn_id || null,
            email,
            userName: userName || 'Unknown',
            amountNGN: parseFloat(amountNGN),
            amountUSD: parseFloat(usd),
            amount_crypto: result.amount || null,
            cryptoType,
            currency: plisioCurrency,
            walletAddress,
            status: TEST_MODE ? 'completed' : 'processing',
            test_mode: TEST_MODE,
            created: Date.now()
        };
        writeWithdrawals(withdrawals);

        console.log('[WITHDRAW] Created:', wid);

        res.json({
            status: 'success',
            data: {
                withdrawal_id: wid,
                plisio_txn_id: result.txn_id,
                amount_usd: usd,
                amount_crypto: result.amount,
                currency: plisioCurrency,
                status: withdrawals[wid].status,
                test_mode: TEST_MODE
            }
        });

    } catch (error) {
        console.error('[WITHDRAW] ERROR:', error.message);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// ═══════ WITHDRAWAL STATUS ═══════
app.get('/api/withdrawal-status', async (req, res) => {
    const { withdrawal_id } = req.query;
    if (!withdrawal_id) return res.status(400).json({ status: 'error', message: 'Missing withdrawal_id' });
    const all = readWithdrawals();
    const wd = all[withdrawal_id];
    if (!wd) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });

    if (wd.test_mode && wd.status === 'processing' && Date.now() - wd.created > 5000) {
        wd.status = 'completed';
        wd.updated = Date.now();
        writeWithdrawals(all);
    }

    res.json({
        status: 'success',
        data: {
            withdrawal_id: wd.withdrawal_id,
            status: wd.status,
            amountNGN: wd.amountNGN,
            cryptoType: wd.cryptoType,
            walletAddress: wd.walletAddress,
            created: wd.created,
            test_mode: wd.test_mode
        }
    });
});

app.get('/api/user-withdrawals/:email', (req, res) => {
    res.json({ status: 'success', data: Object.values(readWithdrawals()).filter(w => w.email === req.params.email).sort((a, b) => b.created - a.created) });
});

// ═══════ EXPIRE OLD INVOICES ═══════
setInterval(() => {
    const inv = readInvoices();
    const now = Date.now();
    let ch = false;
    for (const id in inv) {
        if (inv[id].status === 'pending' && now - inv[id].created > 1800000) {
            inv[id].status = 'expired';
            ch = true;
        }
    }
    if (ch) writeInvoices(inv);
}, 1800000);

// ═══════ SPA FALLBACK ═══════
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// ═══════ START ═══════
app.listen(PORT, () => {
    const c = plisioReady();
    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║        QUMOVCOIN SERVER RUNNING              ║');
    console.log('╠═══════════════════════════════════════════════╣');
    console.log('║  Port:     http://localhost:' + String(PORT).padEnd(31) + '║');
    console.log('║  Admin:    http://localhost:' + String(PORT) + '/admin.html    ║');

    if (c.ok) {
        console.log('║  Plisio:   ✅ CONNECTED                       ║');
        console.log('║  Key:      ' + PLISIO_KEY.substring(0, 8) + '...' + PLISIO_KEY.substring(PLISIO_KEY.length - 4).padEnd(29) + '║');
    } else {
        console.log('║  Plisio:   ❌ NOT CONFIGURED                  ║');
        console.log('║  Reason:   ' + c.reason.substring(0, 33).padEnd(29) + '║');
    }

    console.log('║  Test Mode: ' + (TEST_MODE ? 'YES (simulated)' : 'NO (real crypto)').padEnd(35) + '║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');
});