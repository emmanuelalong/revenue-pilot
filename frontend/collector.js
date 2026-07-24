const API = 'https://revenue-pilot-api.onrender.com/api';
const app = document.getElementById('app');

let state = {
  collector: JSON.parse(sessionStorage.getItem('collector') || 'null'),
  vendors: [],
  selectedVendor: null,
  todayTotal: 0,
  todayCount: 0,
};

function money(n) { return 'SSP ' + Number(n).toLocaleString(); }

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

function render() {
  if (!state.collector) return renderLogin();
  if (state.selectedVendor) return renderCollect();
  return renderVendorList();
}

function renderLogin() {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="eyebrow">Market Revenue Pilot</span>
        <span class="name">Collector Login</span>
      </div>
    </div>
    <div class="screen">
      <h1>Sign in</h1>
      <p class="sub">Every collector uses their own phone + PIN. No shared logins.</p>
      <label>Phone number</label>
      <input id="phone" type="tel" placeholder="0925550101" />
      <label>PIN</label>
      <input id="pin" type="password" inputmode="numeric" placeholder="••••" />
      <div class="err" id="loginErr"></div>
      <button class="btn" id="loginBtn">Sign in</button>
      <p class="sub" style="margin-top:18px;font-size:11px;">Demo PINs — Achol Deng 0925550101/1111 · Peter Lomude 0925550102/2222 · Grace Nyandeng 0925550103/3333</p>
    </div>
  `;
  document.getElementById('loginBtn').onclick = async () => {
    const phone = document.getElementById('phone').value.trim();
    const pin_code = document.getElementById('pin').value.trim();
    const errEl = document.getElementById('loginErr');
    try {
      const { collector } = await api('/login', { method: 'POST', body: JSON.stringify({ phone, pin_code }) });
      state.collector = collector;
      sessionStorage.setItem('collector', JSON.stringify(collector));
      await loadVendors();
      render();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  };
}

async function loadVendors() {
  state.vendors = await api('/vendors?market_id=' + state.collector.assigned_market_id);
  const txns = await api('/transactions?collector_id=' + state.collector.id);
  const today = new Date().toISOString().slice(0, 10);
  const todays = txns.filter(t => t.collected_at.slice(0, 10) === today);
  state.todayTotal = todays.reduce((s, t) => s + t.amount, 0);
  state.todayCount = todays.length;
}

function renderVendorList() {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="eyebrow">${state.collector.market_name}</span>
        <span class="name">${state.collector.name}</span>
      </div>
      <button class="logout" id="logoutBtn">Sign out</button>
    </div>
    <div class="screen">
      <h1>Collect fees</h1>
      <p class="sub">Select a stall to record today's payment.</p>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(state.todayTotal)}</div><div class="lbl">Collected today</div></div>
        <div class="stat"><div class="num">${state.todayCount}</div><div class="lbl">Transactions today</div></div>
      </div>
      <label style="margin-top:20px;">Vendors — ${state.vendors.length} registered</label>
      <div class="vendor-grid" id="vendorGrid"></div>
    </div>
  `;
  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem('collector');
    state = { collector: null, vendors: [], selectedVendor: null, todayTotal: 0, todayCount: 0 };
    render();
  };
  const grid = document.getElementById('vendorGrid');
  state.vendors.forEach(v => {
    const card = document.createElement('button');
    card.className = 'vendor-card' + (v.phone ? '' : ' nophone');
    card.innerHTML = `
      <div class="stall">${v.stall_number}</div>
      <div class="vname">${v.name}</div>
      <div class="fee">${money(v.registered_fee)}</div>
    `;
    card.onclick = () => { state.selectedVendor = v; state.method = 'momo'; state.receipt = null; render(); };
    grid.appendChild(card);
  });
}

function renderCollect() {
  const v = state.selectedVendor;
  if (state.receipt) return renderReceipt();
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="eyebrow">${state.collector.market_name}</span>
        <span class="name">${state.collector.name}</span>
      </div>
      <button class="logout" id="logoutBtn">Sign out</button>
    </div>
    <div class="screen">
      <div class="collect-header">
        <h1>${v.name}</h1>
      </div>
      <button class="collect-header back" id="backBtn">&larr; back to vendor list</button>
      <p class="sub">${v.stall_number}${v.phone ? ' · ' + v.phone : ' · no phone on file'}</p>

      <label>Amount collected</label>
      <input id="amount" type="number" value="${v.registered_fee}" />

      <label>Payment method</label>
      <div class="method-toggle">
        <button id="momoBtn" class="active">Mobile Money</button>
        <button id="cashBtn">Cash</button>
      </div>

      <div class="err" id="collectErr"></div>
      <button class="btn amber" id="collectBtn">Confirm collection</button>
    </div>
  `;
  document.getElementById('backBtn').onclick = () => { state.selectedVendor = null; render(); };
  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem('collector');
    state = { collector: null, vendors: [], selectedVendor: null, todayTotal: 0, todayCount: 0 };
    render();
  };
  const momoBtn = document.getElementById('momoBtn');
  const cashBtn = document.getElementById('cashBtn');
  let method = 'momo';
  momoBtn.onclick = () => { method = 'momo'; momoBtn.classList.add('active'); cashBtn.classList.remove('active'); };
  cashBtn.onclick = () => { method = 'cash'; cashBtn.classList.add('active'); momoBtn.classList.remove('active'); };

  document.getElementById('collectBtn').onclick = async () => {
    const amount = Number(document.getElementById('amount').value);
    const errEl = document.getElementById('collectErr');
    try {
      const result = await api('/collect', {
        method: 'POST',
        body: JSON.stringify({
          vendor_id: v.id,
          collector_id: state.collector.id,
          amount,
          method,
        }),
      });
      state.receipt = result;
      state.todayTotal += amount;
      state.todayCount += 1;
      render();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  };
}

function renderReceipt() {
  const v = state.selectedVendor;
  const r = state.receipt;
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="eyebrow">${state.collector.market_name}</span>
        <span class="name">${state.collector.name}</span>
      </div>
      <button class="logout" id="logoutBtn">Sign out</button>
    </div>
    <div class="screen">
      <h1>Collected ✓</h1>
      <p class="sub">${v.name} · ${v.stall_number}</p>
      <div class="receipt">
        <div style="font-size:12px;color:#5a6f68;">Receipt code</div>
        <div class="code">${r.receipt_code}</div>
        <div style="font-size:13px;color:#5a6f68;">${new Date(r.collected_at).toLocaleString()}</div>
        ${r.sms_sent ? `
          <div class="sms-note">SMS receipt sent to vendor (${r.sms.to})</div>
          <div class="sms-body">${r.sms.message}</div>
        ` : `
          <div class="sms-note" style="color:var(--risk);">No phone on file for this vendor — no SMS sent. Show the vendor this receipt code.</div>
        `}
      </div>
      <button class="btn" id="nextBtn">Next collection</button>
    </div>
  `;
  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem('collector');
    state = { collector: null, vendors: [], selectedVendor: null, todayTotal: 0, todayCount: 0 };
    render();
  };
  document.getElementById('nextBtn').onclick = () => { state.selectedVendor = null; state.receipt = null; render(); };
}

(async function init() {
  if (state.collector) {
    try { await loadVendors(); } catch (e) { /* ignore, will show login-ish state */ }
  }
  render();
})();
