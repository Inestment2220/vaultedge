require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PLISIO_KEY = process.env.PLISIO_SECRET_KEY || '';
const NGN_TO_USD = parseFloat(process.env.NGN_TO_USD) || 0.00065;
const INVOICES_FILE = path.join(__dirname, 'invoices.json');
const WITHDRAWALS_FILE = path.join(__dirname, 'withdrawals.json');
const PLISIO_BASE = 'https://api.plisio.net/api/v1';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function plisioGet(endpoint, params) {
    return new Promise((resolve, reject) => {
        const queryParams = new URLSearchParams({ ...params, api_key: PLISIO_KEY }).toString();
        const url = PLISIO_BASE + endpoint + '?' + queryParams;
        const req = https.get(url, { headers: { 'Content-Type': 'application/json' } }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.status === 'success') { resolve(json); }
                    else { reject({ message: (json.data && json.data.message) || json.err_msg || 'Plisio error' }); }
                } catch (e) { reject({ message: 'Invalid JSON' }); }
            });
        });
        req.on('error', (e) => reject({ message: e.message }));
        req.setTimeout(30000, () => { req.destroy(); reject({ message: 'Timeout' }); });
    });
}

function plisioReady() {
    if (!PLISIO_KEY) return { ok: false, reason: 'PLISIO_SECRET_KEY is empty' };
    return { ok: true };
}

function plisioReject(res, detail) {
    return res.status(503).json({ status: 'error', message: 'Plisio not configured: ' + detail });
}

function readInvoices() { try { return JSON.parse(fs.readFileSync(INVOICES_FILE, 'utf8')); } catch (e) { return {}; } }
function writeInvoices(data) { fs.writeFileSync(INVOICES_FILE, JSON.stringify(data, null, 2)); }
function readWithdrawals() { try { return JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf8')); } catch (e) { return {}; } }
function writeWithdrawals(data) { fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(data, null, 2)); }

app.get('/api/health', (req, res) => {
    const check = plisioReady();
    res.json({ status: 'ok', plisio_configured: check.ok, plisio_issue: check.ok ? null : check.reason, key_length: PLISIO_KEY.length, port: PORT });
});

app.get('/api/balance/:currency', async (req, res) => {
    const check = plisioReady(); if (!check.ok) return plisioReject(res, check.reason);
    try { const result = await plisioGet('/balances', { psys: req.params.currency }); res.json({ status: 'success', data: { currency: req.params.currency, balance: result.data?.balance || '0' } }); }
    catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.get('/api/balances', async (req, res) => {
    const check = plisioReady(); if (!check.ok) return plisioReject(res, check.reason);
    try { res.json(await plisioGet('/balances', {})); } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.get('/api/currencies', async (req, res) => {
    const check = plisioReady(); if (!check.ok) return plisioReject(res, check.reason);
    try { res.json(await plisioGet('/currencies', {})); } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/create-invoice', async (req, res) => {
    const check = plisioReady(); if (!check.ok) return plisioReject(res, check.reason);
    const { email, level, amountNGN, cryptoType } = req.body;
    if (!email || !level || !amountNGN || !cryptoType) return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    const cryptoMap = { usdt: 'USDT_TRX', btc: 'BTC' };
    const plisioCurrency = cryptoMap[cryptoType];
    if (!plisioCurrency) return res.status(400).json({ status: 'error', message: 'Unsupported crypto type' });
    const usdAmount = (parseFloat(amountNGN) * NGN_TO_USD).toFixed(2);
    const orderNumber = 'QM_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();
    console.log('Creating invoice | User:', email, '| Level:', level, '|', amountNGN, 'NGN =', usdAmount, 'USD |', plisioCurrency);
    try {
        const result = await plisioGet('/invoices/new', { source_currency: 'USD', source_amount: usdAmount, order_name: 'Qumovcoin Level ' + level, order_number: orderNumber, currency: plisioCurrency, email: email, expire_min: '30' });
        if (result.data) {
            const invoice = result.data;
            const invoices = readInvoices();
            invoices[invoice.txn_id] = { txn_id: invoice.txn_id, email, level: parseInt(level), amountNGN: parseFloat(amountNGN), amountUSD: parseFloat(usdAmount), cryptoType, wallet_hash: invoice.wallet_hash, invoice_url: invoice.invoice_url, amount_crypto: invoice.amount, currency: plisioCurrency, status: 'pending', created: Date.now() };
            writeInvoices(invoices);
            console.log('Invoice created:', invoice.txn_id);
            return res.json({ status: 'success', data: { txn_id: invoice.txn_id, wallet_hash: invoice.wallet_hash, invoice_url: invoice.invoice_url, amount_crypto: invoice.amount, currency: plisioCurrency, amount_usd: usdAmount, expire_min: 30 } });
        }
    } catch (error) { console.error('Invoice error:', error.message); return res.status(400).json({ status: 'error', message: error.message }); }
});

app.get('/api/invoice-status', async (req, res) => {
    const { txn_id } = req.query;
    if (!txn_id) return res.status(400).json({ status: 'error', message: 'Missing txn_id' });
    const invoices = readInvoices();
    const localInvoice = invoices[txn_id];
    const check = plisioReady();
    if (check.ok) {
        try {
            const result = await plisioGet('/invoices/' + txn_id, {});
            if (result.data) {
                if (localInvoice) {
                    const ps = result.data.status;
                    const ls = ps === 'completed' ? 'paid' : ps === 'expired' ? 'expired' : ps;
                    if (localInvoice.status !== ls) { invoices[txn_id].status = ls; invoices[txn_id].updated = Date.now(); writeInvoices(invoices); if (ls === 'paid') console.log('DEPOSIT CONFIRMED |', txn_id, '|', localInvoice.email); }
                }
                return res.json({ status: 'success', data: { txn_id: result.data.txn_id, status: result.data.status, level: localInvoice?.level, amountNGN: localInvoice?.amountNGN, email: localInvoice?.email } });
            }
        } catch (e) { console.error('Poll error:', e.message); }
    }
    if (localInvoice) return res.json({ status: 'success', data: { txn_id: localInvoice.txn_id, status: localInvoice.status === 'paid' ? 'completed' : localInvoice.status, level: localInvoice.level, amountNGN: localInvoice.amountNGN, email: localInvoice.email } });
    res.status(404).json({ status: 'error', message: 'Invoice not found' });
});

app.post('/api/withdraw', async (req, res) => {
    const check = plisioReady(); if (!check.ok) return plisioReject(res, check.reason);
    const { email, amountNGN, cryptoType, walletAddress, userName } = req.body;
    if (!email || !amountNGN || !cryptoType || !walletAddress) return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    if (parseFloat(amountNGN) <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
    const cryptoMap = { usdt: 'USDT_TRX', btc: 'BTC' };
    const plisioCurrency = cryptoMap[cryptoType];
    if (!plisioCurrency) return res.status(400).json({ status: 'error', message: 'Unsupported crypto type' });
    const usdAmount = (parseFloat(amountNGN) * NGN_TO_USD).toFixed(2);
    const withdrawalId = 'WD_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();
    console.log('Withdrawal |', withdrawalId, '|', email, '|', amountNGN, 'NGN =', usdAmount, 'USD |', plisioCurrency);
    try {
        const result = await plisioGet('/withdrawals/new', { source_currency: 'USD', source_amount: usdAmount, currency: plisioCurrency, address: walletAddress, type: 'crypto' });
        if (result.data) {
            const wd = result.data;
            const withdrawals = readWithdrawals();
            withdrawals[withdrawalId] = { withdrawal_id: withdrawalId, plisio_txn_id: wd.txn_id || null, email, userName: userName || 'Unknown', amountNGN: parseFloat(amountNGN), amountUSD: parseFloat(usdAmount), amount_crypto: wd.amount || null, cryptoType, currency: plisioCurrency, walletAddress, status: 'processing', created: Date.now() };
            writeWithdrawals(withdrawals);
            console.log('Withdrawal submitted:', withdrawalId);
            return res.json({ status: 'success', data: { withdrawal_id: withdrawalId, plisio_txn_id: wd.txn_id, amount_usd: usdAmount, amount_crypto: wd.amount, currency: plisioCurrency, status: 'processing' } });
        }
    } catch (error) { console.error('Withdrawal error:', error.message); return res.status(400).json({ status: 'error', message: error.message || 'Withdrawal failed' }); }
});

app.get('/api/withdrawal-status', async (req, res) => {
    const { withdrawal_id } = req.query;
    if (!withdrawal_id) return res.status(400).json({ status: 'error', message: 'Missing withdrawal_id' });
    const withdrawals = readWithdrawals();
    const withdrawal = withdrawals[withdrawal_id];
    if (!withdrawal) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const check = plisioReady();
    if (check.ok && withdrawal.plisio_txn_id) {
        try {
            const result = await plisioGet('/withdrawals/' + withdrawal.plisio_txn_id, {});
            if (result.data) { const ns = result.data.status === 'completed' ? 'completed' : result.data.status; if (withdrawal.status !== ns) { withdrawals[withdrawal_id].status = ns; withdrawals[withdrawal_id].updated = Date.now(); writeWithdrawals(withdrawals); } }
        } catch (e) { console.error('Withdrawal check error:', e.message); }
    }
    const u = withdrawals[withdrawal_id];
    res.json({ status: 'success', data: { withdrawal_id: u.withdrawal_id, status: u.status, amountNGN: u.amountNGN, cryptoType: u.cryptoType, walletAddress: u.walletAddress, created: u.created } });
});

app.get('/api/transactions', async (req, res) => {
    const check = plisioReady(); if (!check.ok) return plisioReject(res, check.reason);
    try { res.json(await plisioGet('/operations', { page: req.query.page || 1, page_size: req.query.page_size || 20 })); }
    catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.get('/api/user-withdrawals/:email', (req, res) => {
    const withdrawals = readWithdrawals();
    res.json({ status: 'success', data: Object.values(withdrawals).filter(w => w.email === req.params.email).sort((a, b) => b.created - a.created) });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

setInterval(() => {
    const invoices = readInvoices(); const now = Date.now(); let changed = false;
    for (const id in invoices) { if (invoices[id].status === 'pending' && now - invoices[id].created > 1800000) { invoices[id].status = 'expired'; changed = true; } }
    if (changed) writeInvoices(invoices);
}, 1800000);

app.listen(PORT, () => {
    const check = plisioReady();
    console.log('');
    if (check.ok) { console.log('Plisio: CONNECTED'); console.log('Key: ' + PLISIO_KEY.substring(0, 8) + '...' + PLISIO_KEY.substring(PLISIO_KEY.length - 4)); }
    else { console.log('Plisio: NOT SET — ' + check.reason); }
    console.log('Server: http://localhost:' + PORT);
    console.log('');
});
