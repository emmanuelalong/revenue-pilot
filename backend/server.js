const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

function receiptCode() {
  return 'RCT-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---------- Auth (simple PIN login for pilot) ----------
app.post('/api/login', (req, res) => {
  const { phone, pin_code } = req.body;
  const collector = db.prepare(
    `SELECT c.*, m.name as market_name FROM collectors c
     JOIN markets m ON m.id = c.assigned_market_id
     WHERE c.phone = ? AND c.pin_code = ?`
  ).get(phone, pin_code);
  if (!collector) return res.status(401).json({ error: 'Invalid phone or PIN' });
  res.json({ collector });
});

// ---------- Reference data ----------
app.get('/api/markets', (req, res) => {
  res.json(db.prepare('SELECT * FROM markets').all());
});

app.get('/api/vendors', (req, res) => {
  const { market_id } = req.query;
  const rows = market_id
    ? db.prepare('SELECT * FROM vendors WHERE market_id = ? AND active = 1 ORDER BY stall_number').all(market_id)
    : db.prepare('SELECT * FROM vendors WHERE active = 1').all();
  res.json(rows);
});

app.get('/api/collectors', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, m.name as market_name FROM collectors c
    JOIN markets m ON m.id = c.assigned_market_id
  `).all());
});

// ---------- Collection (the core anti-leakage action) ----------
app.post('/api/collect', (req, res) => {
  const { vendor_id, collector_id, amount, method, gps_lat, gps_lng } = req.body;
  if (!vendor_id || !collector_id || !amount || !method) {
    return res.status(400).json({ error: 'vendor_id, collector_id, amount, and method are required' });
  }

  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor_id);
  const collector = db.prepare('SELECT * FROM collectors WHERE id = ?').get(collector_id);
  if (!vendor || !collector) return res.status(404).json({ error: 'Vendor or collector not found' });

  const now = new Date().toISOString();
  const code = receiptCode();

  const info = db.prepare(`
    INSERT INTO transactions
      (vendor_id, collector_id, market_id, amount, method, gps_lat, gps_lng, collected_at, synced_at, receipt_code, receipt_sms_sent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vendor_id, collector_id, vendor.market_id, amount, method,
    gps_lat || null, gps_lng || null, now, now, code, vendor.phone ? 1 : 0
  );

  let sms = null;
  if (vendor.phone) {
    const message = `Receipt ${code}: You paid SSP ${amount} market fee at stall ${vendor.stall_number} on ${now.slice(0,10)}. Keep this as proof of payment. Complaint? Text HELP to this number.`;
    db.prepare(`INSERT INTO sms_log (transaction_id, to_phone, message, sent_at) VALUES (?, ?, ?, ?)`)
      .run(info.lastInsertRowid, vendor.phone, message, now);
    sms = { to: vendor.phone, message };
  }

  res.json({
    transaction_id: info.lastInsertRowid,
    receipt_code: code,
    collected_at: now,
    sms_sent: !!sms,
    sms
  });
});

app.get('/api/transactions', (req, res) => {
  const { market_id, collector_id, limit } = req.query;
  let sql = `
    SELECT t.*, v.name as vendor_name, v.stall_number, c.name as collector_name, m.name as market_name
    FROM transactions t
    JOIN vendors v ON v.id = t.vendor_id
    JOIN collectors c ON c.id = t.collector_id
    JOIN markets m ON m.id = t.market_id
    WHERE 1=1
  `;
  const params = [];
  if (market_id) { sql += ' AND t.market_id = ?'; params.push(market_id); }
  if (collector_id) { sql += ' AND t.collector_id = ?'; params.push(collector_id); }
  sql += ' ORDER BY t.collected_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
  res.json(db.prepare(sql).all(...params));
});

// ---------- Complaints ----------
app.post('/api/complaints', (req, res) => {
  const { vendor_id, transaction_id, market_id, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO complaints (vendor_id, transaction_id, market_id, message, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `).run(vendor_id || null, transaction_id || null, market_id || null, message, now);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/complaints', (req, res) => {
  res.json(db.prepare(`
    SELECT co.*, m.name as market_name, v.name as vendor_name
    FROM complaints co
    LEFT JOIN markets m ON m.id = co.market_id
    LEFT JOIN vendors v ON v.id = co.vendor_id
    ORDER BY co.created_at DESC
  `).all());
});

app.patch('/api/complaints/:id', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE complaints SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// ---------- Dashboard: summary + variance flagging ----------
app.get('/api/dashboard/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) as txn_count, COALESCE(SUM(amount),0) as total_collected
    FROM transactions
  `).get();

  const byMarket = db.prepare(`
    SELECT m.id, m.name, m.county, m.registered_vendor_count, m.standard_daily_fee,
           COUNT(t.id) as txn_count, COALESCE(SUM(t.amount),0) as total_collected
    FROM markets m
    LEFT JOIN transactions t ON t.market_id = m.id
    GROUP BY m.id
  `).all();

  const byDay = db.prepare(`
    SELECT substr(collected_at,1,10) as day, COALESCE(SUM(amount),0) as total, COUNT(*) as txn_count
    FROM transactions
    GROUP BY day
    ORDER BY day ASC
  `).all();

  const openComplaints = db.prepare(`SELECT COUNT(*) c FROM complaints WHERE status = 'open'`).get().c;

  res.json({ totals, byMarket, byDay, openComplaints });
});

// Flags collectors whose recent daily collection is well below what's expected
// given their market's registered vendor count and standard fee.
app.get('/api/dashboard/variance', (req, res) => {
  const collectors = db.prepare(`
    SELECT c.id as collector_id, c.name as collector_name, c.assigned_market_id,
           m.name as market_name, m.registered_vendor_count, m.standard_daily_fee
    FROM collectors c JOIN markets m ON m.id = c.assigned_market_id
  `).all();

  const results = collectors.map(c => {
    const expectedDaily = c.registered_vendor_count * c.standard_daily_fee;

    const last7 = db.prepare(`
      SELECT substr(collected_at,1,10) as day, COALESCE(SUM(amount),0) as total
      FROM transactions
      WHERE collector_id = ? AND collected_at >= datetime('now','-7 day')
      GROUP BY day
    `).all(c.collector_id);

    const avgDaily = last7.length ? last7.reduce((s, r) => s + r.total, 0) / last7.length : 0;
    const variancePct = expectedDaily > 0 ? Math.round(((avgDaily - expectedDaily) / expectedDaily) * 100) : 0;

    let flag = 'ok';
    if (variancePct <= -40) flag = 'high_risk';
    else if (variancePct <= -20) flag = 'watch';

    return {
      collector_id: c.collector_id,
      collector_name: c.collector_name,
      market_name: c.market_name,
      expected_daily: expectedDaily,
      avg_daily_last7: Math.round(avgDaily),
      variance_pct: variancePct,
      flag
    };
  });

  res.json(results);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Revenue pilot API running on http://localhost:${PORT}`);
});
