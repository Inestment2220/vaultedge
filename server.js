const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5500;
const PLISIO_KEY = process.env.PLISIO_SECRET_KEY || '';
const NGN_TO_USD = parseFloat(process.env.NGN_TO_USD) || 0.00067;
const INVOICES_FILE = path.join(__dirname, 'invoices.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const MIME = {
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'
};

app.get('*', (req, res) => {
  if (req.xhr || req.path.startsWith('/api/')) return;
  let fp = path.join(__dirname, 'public', req.path === '/' ? 'index.html' : req.path);
  let ext = path.extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.sendFile(path.join(__dirname, 'public', 'index.html')); return; }
    res.type(MIME[ext] || 'application/octet-stream').send(data);
  });
});

function readInvoices() { try { return JSON.parse(fs.readFileSync(INVOICES_FILE, 'utf8')); } catch(e) { return {}; } }
function writeInvoices(d) { fs.writeFileSync(INVOICES_FILE, JSON.stringify(d, null, 2)); }

function plisioRequest(params) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'plisio.net', path: '/api/v1/invoices/new', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Plisio-API-Key': PLISIO_KEY }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject({ message: 'Invalid response' }); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

app.post('/api/create-invoice', async (req, res) => {
  if (!PLISIO_KEY) return res.json({ status: 'error', message: 'Plisio API key not configured' });
  const { email, level, amountNGN, cryptoType } = req.body;
  if (!email || !level || !amountNGN || !cryptoType) return res.json({ status: 'error', message: 'Missing fields' });
  const cm = { usdt: 'USDT.TRX', btc: 'BTC' };
  const pc = cm[cryptoType];
  if (!pc) return res.json({ status: 'error', message: 'Unsupported crypto' });
  const usd = (parseFloat(amountNGN) * NGN_TO_USD).toFixed(2);
  const on = 'QM_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const webhookUrl = (process.env.RAILWAY_STATIC_URL || 'http://localhost:' + PORT) + '/api/webhook';
  try {
    const r = await plisioRequest({ source_currency:'USD', source_amount:usd, order_name:'Qumovcoin Level '+level, order_number:on, currency:pc, callback_url:webhookUrl, email:email, expire_min:'120' });
    if (r.status === 'success' && r.data) {
      const inv = readInvoices();
      inv[r.data.txn_id] = { txn_id:r.data.txn_id, email, level:parseInt(level), amountNGN:parseFloat(amountNGN), cryptoType, wallet_hash:r.data.wallet_hash, invoice_url:r.data.invoice_url, amount_crypto:r.data.amount, status:'pending', created:Date.now() };
      writeInvoices(inv);
      return res.json({ status:'success', data:{ txn_id:r.data.txn_id, wallet_hash:r.data.wallet_hash, invoice_url:r.data.invoice_url, amount_crypto:r.data.amount, currency:pc, amount_usd:usd, expire_min:120 } });
    }
    return res.json({ status:'error', message: r.message || 'Plisio error' });
  } catch(e) { return res.json({ status:'error', message:'Failed to connect to Plisio' }); }
});

app.get('/api/invoice-status', (req, res) => {
  const { txn_id } = req.query;
  if (!txn_id) return res.json({ status:'error', message:'Missing txn_id' });
  const inv = readInvoices()[txn_id];
  if (!inv) return res.json({ status:'error', message:'Not found' });
  return res.json({ status:'success', data:{ txn_id:inv.txn_id, status:inv.status, level:inv.level, amountNGN:inv.amountNGN } });
});

app.post('/api/webhook', (req, res) => {
  console.log('Webhook:', JSON.stringify(req.body));
  const { txn_id, status } = req.body;
  if (!txn_id) return res.json({ status:'error' });
  const inv = readInvoices();
  if (inv[txn_id]) { inv[txn_id].status = status === 'completed' ? 'paid' : status; inv[txn_id].updated = Date.now(); writeInvoices(inv); }
  return res.json({ status:'success' });
});

setInterval(() => {
  const inv = readInvoices(); let c = false; const n = Date.now();
  for (const t in inv) { if (inv[t].status === 'pending' && n - inv[t].created > 10800000) { inv[t].status = 'expired'; c = true; } }
  if (c) writeInvoices(inv);
}, 1800000);

app.listen(PORT, () => console.log('Qumovcoin on port ' + PORT + ' | Plisio: ' + (PLISIO_KEY ? 'OK' : 'NOT SET')));
