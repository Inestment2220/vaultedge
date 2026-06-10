const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PLISIO_KEY = process.env.PLISIO_SECRET_KEY || '';
const NGN_TO_USD = parseFloat(process.env.NGN_TO_USD) || 0.00067;
const INVOICES_FILE = path.join(__dirname, 'invoices.json');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MIME types for static files
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// Serve static files with proper MIME
app.get('*', (req, res) => {
  if (req.xhr || req.path.startsWith('/api/')) return;
  let filePath = path.join(__dirname, 'public', req.path === '/' ? 'index.html' : req.path);
  let ext = path.extname(filePath).toLowerCase();
  let ct = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.sendFile(path.join(__dirname, 'public', 'index.html')); return; }
    res.type(ct).send(data);
  });
});

// ===== INVOICE STORAGE =====
function readInvoices() {
  try { return JSON.parse(fs.readFileSync(INVOICES_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function writeInvoices(data) {
  fs.writeFileSync(INVOICES_FILE, JSON.stringify(data, null, 2));
}

// ===== PLISIO API CALL =====
function plisioRequest(params) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(params).toString();
    const options = {
      hostname: 'plisio.net',
      path: '/api/v1/invoices/new',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Plisio-API-Key': PLISIO_KEY
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject({ status: 'error', message: 'Invalid response from Plisio' }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ===== CREATE INVOICE =====
app.post('/api/create-invoice', async (req, res) => {
  if (!PLISIO_KEY) {
    return res.json({ status: 'error', message: 'Plisio API key not configured on server' });
  }

  const { email, level, amountNGN, cryptoType } = req.body;
  if (!email || !level || !amountNGN || !cryptoType) {
    return res.json({ status: 'error', message: 'Missing required fields' });
  }

  const currencyMap = {
    'usdt': 'USDT.TRX',
    'btc': 'BTC'
  };

  const plisioCurrency = currencyMap[cryptoType];
  if (!plisioCurrency) {
    return res.json({ status: 'error', message: 'Unsupported crypto type' });
  }

  const amountUSD = (parseFloat(amountNGN) * NGN_TO_USD).toFixed(2);
  const orderNumber = 'QM_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const callbackUrl = `${process.env.RAILWAY_STATIC_URL || 'http://localhost:' + PORT}/api/webhook`;

  try {
    const result = await plisioRequest({
      source_currency: 'USD',
      source_amount: amountUSD,
      order_name: 'Qumovcoin Level ' + level,
      order_number: orderNumber,
      currency: plisioCurrency,
      callback_url: callbackUrl,
      email: email,
      expire_min: '120'
    });

    if (result.status === 'success' && result.data) {
      // Store invoice locally
      const invoices = readInvoices();
      invoices[result.data.txn_id] = {
        txn_id: result.data.txn_id,
        email: email,
        level: parseInt(level),
        amountNGN: parseFloat(amountNGN),
        amountUSD: parseFloat(amountUSD),
        cryptoType: cryptoType,
        plisioCurrency: plisioCurrency,
        wallet_hash: result.data.wallet_hash,
        invoice_url: result.data.invoice_url,
        amount_crypto: result.data.amount,
        status: 'pending',
        created: Date.now()
      };
      writeInvoices(invoices);

      return res.json({
        status: 'success',
        data: {
          txn_id: result.data.txn_id,
          wallet_hash: result.data.wallet_hash,
          invoice_url: result.data.invoice_url,
          amount_crypto: result.data.amount,
          currency: plisioCurrency,
          amount_usd: amountUSD,
          expire_min: 120
        }
      });
    } else {
      return res.json({ status: 'error', message: result.message || 'Plisio API error' });
    }
  } catch (err) {
    console.error('Plisio error:', err);
    return res.json({ status: 'error', message: 'Failed to connect to Plisio' });
  }
});

// ===== CHECK INVOICE STATUS =====
app.get('/api/invoice-status', (req, res) => {
  const { txn_id } = req.query;
  if (!txn_id) {
    return res.json({ status: 'error', message: 'Missing txn_id' });
  }
  const invoices = readInvoices();
  const inv = invoices[txn_id];
  if (!inv) {
    return res.json({ status: 'error', message: 'Invoice not found' });
  }
  return res.json({ status: 'success', data: { txn_id: inv.txn_id, status: inv.status, level: inv.level, amountNGN: inv.amountNGN } });
});

// ===== PLISIO WEBHOOK =====
app.post('/api/webhook', (req, res) => {
  console.log('Plisio webhook received:', JSON.stringify(req.body));
  const { txn_id, status } = req.body;
  if (!txn_id) {
    return res.json({ status: 'error', message: 'Missing txn_id' });
  }
  const invoices = readInvoices();
  if (invoices[txn_id]) {
    invoices[txn_id].status = status === 'completed' ? 'paid' : status;
    invoices[txn_id].updated = Date.now();
    writeInvoices(invoices);
    console.log('Invoice ' + txn_id + ' updated to: ' + status);
  }
  return res.json({ status: 'success' });
});

// ===== CLEAN EXPIRED INVOICES (every 30 min) =====
setInterval(() => {
  const invoices = readInvoices();
  let changed = false;
  const now = Date.now();
  for (const txn_id in invoices) {
    if (invoices[txn_id].status === 'pending' && now - invoices[txn_id].created > 3 * 60 * 60 * 1000) {
      invoices[txn_id].status = 'expired';
      changed = true;
    }
  }
  if (changed) {
    writeInvoices(invoices);
    console.log('Cleaned expired invoices');
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('Qumovcoin running on port ' + PORT);
  console.log('Plisio API key: ' + (PLISIO_KEY ? 'configured' : 'NOT SET'));
});