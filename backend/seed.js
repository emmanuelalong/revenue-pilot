const db = require('./db');

function reset() {
  db.exec(`
    DELETE FROM complaints;
    DELETE FROM sms_log;
    DELETE FROM transactions;
    DELETE FROM vendors;
    DELETE FROM collectors;
    DELETE FROM markets;
    DELETE FROM sqlite_sequence;
  `);
}

function receiptCode() {
  return 'RCT-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function isoDaysAgo(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

reset();

// --- Markets ---
const insertMarket = db.prepare(`
  INSERT INTO markets (name, county, gps_lat, gps_lng, standard_daily_fee, registered_vendor_count)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const markets = [
  ['Konyo-Konyo Market', 'Juba County', 4.8472, 31.5942, 2000, 40],
  ['Custom Market', 'Juba County', 4.8517, 31.5825, 2500, 30],
  ['Jebel Market', 'Juba County', 4.8103, 31.5697, 1500, 25],
];
const marketIds = markets.map(m => insertMarket.run(...m).lastInsertRowid);

// --- Collectors ---
const insertCollector = db.prepare(`
  INSERT INTO collectors (name, phone, assigned_market_id, pin_code)
  VALUES (?, ?, ?, ?)
`);
const collectors = [
  ['Achol Deng', '0925550101', marketIds[0], '1111'],
  ['Peter Lomude', '0925550102', marketIds[1], '2222'],
  ['Grace Nyandeng', '0925550103', marketIds[2], '3333'],
];
const collectorIds = collectors.map(c => insertCollector.run(...c).lastInsertRowid);

// --- Vendors ---
const insertVendor = db.prepare(`
  INSERT INTO vendors (name, stall_number, market_id, phone, registered_fee, active)
  VALUES (?, ?, ?, ?, ?, 1)
`);
const vendorNamesA = ['Nyibol', 'Abuk', 'Manyok', 'Akech', 'Deng', 'Aluel', 'Majok', 'Nyanut', 'Garang', 'Ayen'];
let vendorIds = { }; // market_id -> [vendorIds]
markets.forEach((m, idx) => {
  const marketId = marketIds[idx];
  const count = m[5];
  vendorIds[marketId] = [];
  for (let i = 1; i <= count; i++) {
    const name = vendorNamesA[i % vendorNamesA.length] + ' ' + (i <= vendorNamesA.length ? '' : i);
    const hasPhone = Math.random() > 0.35; // ~65% of vendors have a phone on file
    const phone = hasPhone ? '09' + (20000000 + Math.floor(Math.random() * 9999999)) : null;
    const id = insertVendor.run(
      name.trim(),
      'Stall-' + i,
      marketId,
      phone,
      m[4],
    ).lastInsertRowid;
    vendorIds[marketId].push(id);
  }
});

// --- Transactions over the past 21 days ---
const insertTxn = db.prepare(`
  INSERT INTO transactions
    (vendor_id, collector_id, market_id, amount, method, gps_lat, gps_lng, collected_at, synced_at, receipt_code, receipt_sms_sent)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSms = db.prepare(`
  INSERT INTO sms_log (transaction_id, to_phone, message, sent_at) VALUES (?, ?, ?, ?)
`);

const DAYS = 21;
for (let day = DAYS; day >= 0; day--) {
  markets.forEach((m, mIdx) => {
    const marketId = marketIds[mIdx];
    const collectorId = collectorIds[mIdx];
    const vids = vendorIds[marketId];
    const standardFee = m[4];

    // Peter Lomude (Custom Market, collectorIds[1]) deliberately under-collects
    // starting 10 days ago -- this is the "leakage" pattern the dashboard should flag.
    const isLeakyCollector = mIdx === 1 && day <= 10;
    const turnoutRate = isLeakyCollector ? 0.45 : (0.75 + Math.random() * 0.2); // fraction of vendors who "paid" on record

    const vendorsToday = vids.filter(() => Math.random() < turnoutRate);

    vendorsToday.forEach((vendorId, i) => {
      const hour = 8 + Math.floor(Math.random() * 8);
      const minute = Math.floor(Math.random() * 60);
      const collectedAt = isoDaysAgo(day, hour, minute);
      const method = Math.random() > 0.4 ? 'momo' : 'cash';
      // Small natural variance in fee (e.g. partial day, small stalls)
      const amount = Math.random() > 0.85 ? Math.round(standardFee * 0.5) : standardFee;
      const code = receiptCode();

      const info = insertTxn.run(
        vendorId, collectorId, marketId, amount, method,
        m[2] + (Math.random() - 0.5) * 0.001,
        m[3] + (Math.random() - 0.5) * 0.001,
        collectedAt, collectedAt, code, 1
      );

      insertSms.run(
        info.lastInsertRowid,
        '09' + (20000000 + Math.floor(Math.random() * 9999999)),
        `Receipt ${code}: You paid SSP ${amount} market fee at ${m[0]} on ${collectedAt.slice(0,10)}. Keep this as proof of payment.`,
        collectedAt
      );
    });
  });
}

// --- A couple of sample complaints ---
const insertComplaint = db.prepare(`
  INSERT INTO complaints (vendor_id, transaction_id, market_id, message, status, created_at)
  VALUES (?, ?, ?, ?, 'open', ?)
`);
const someVendor = vendorIds[marketIds[1]][2];
insertComplaint.run(
  someVendor, null, marketIds[1],
  'Collector asked for SSP 4,000 instead of the posted SSP 2,500 fee and gave no receipt.',
  isoDaysAgo(3, 10, 15)
);
const someVendor2 = vendorIds[marketIds[0]][5];
insertComplaint.run(
  someVendor2, null, marketIds[0],
  'Paid my fee but never received the SMS receipt.',
  isoDaysAgo(1, 14, 0)
);

console.log('Seed complete:');
console.log('Markets:', marketIds.length);
console.log('Collectors:', collectorIds.length);
console.log('Vendors:', Object.values(vendorIds).flat().length);
console.log('Transactions:', db.prepare('SELECT COUNT(*) c FROM transactions').get().c);
console.log('Complaints:', db.prepare('SELECT COUNT(*) c FROM complaints').get().c);
console.log('\nCollector PINs for demo login:');
collectors.forEach((c, i) => console.log(`  ${c[0]} (${markets[i][0]}) - phone ${c[1]} - PIN ${c[3]}`));
