-- Revenue Leakage Plug: Market Fee Collection Pilot
-- Core idea: every fee collection is logged at time-of-collection, tied to a
-- specific collector and a specific pre-registered vendor, with an
-- independent SMS receipt sent to the vendor (their own record the
-- collector cannot edit later).

CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  county TEXT NOT NULL,
  gps_lat REAL,
  gps_lng REAL,
  standard_daily_fee INTEGER NOT NULL DEFAULT 2000, -- in SSP
  registered_vendor_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  assigned_market_id INTEGER NOT NULL,
  pin_code TEXT NOT NULL, -- simple login PIN for pilot (no shared logins)
  FOREIGN KEY (assigned_market_id) REFERENCES markets(id)
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stall_number TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  phone TEXT, -- optional; if present, SMS receipt goes directly to vendor
  registered_fee INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  collector_id INTEGER NOT NULL,
  market_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('momo','cash')),
  gps_lat REAL,
  gps_lng REAL,
  collected_at TEXT NOT NULL, -- ISO timestamp, set at moment of collection (not sync)
  synced_at TEXT NOT NULL,
  receipt_code TEXT NOT NULL UNIQUE, -- verifiable receipt code shown/sent to vendor
  receipt_sms_sent INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (collector_id) REFERENCES collectors(id),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER,
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  transaction_id INTEGER,
  market_id INTEGER,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);
