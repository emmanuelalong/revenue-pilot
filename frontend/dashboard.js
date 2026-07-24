const API = 'http://localhost:4000/api';
let trendChart = null;

function money(n) { return 'SSP ' + Number(n).toLocaleString(); }

async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('Request failed: ' + path);
  return res.json();
}

function flagLabel(flag) {
  if (flag === 'high_risk') return '<span class="tag tag-risk">High risk</span>';
  if (flag === 'watch') return '<span class="tag tag-watch">Watch</span>';
  return '<span class="tag tag-ok">OK</span>';
}

async function load() {
  const [summary, variance, complaints] = await Promise.all([
    api('/dashboard/summary'),
    api('/dashboard/variance'),
    api('/complaints'),
  ]);

  // KPIs
  const openComplaints = complaints.filter(c => c.status === 'open').length;
  const highRisk = variance.filter(v => v.flag === 'high_risk').length;
  document.getElementById('kpiRow').innerHTML = `
    <div class="kpi">
      <div class="val">${money(summary.totals.total_collected)}</div>
      <div class="lbl">Total collected (all time, pilot)</div>
    </div>
    <div class="kpi">
      <div class="val">${summary.totals.txn_count.toLocaleString()}</div>
      <div class="lbl">Transactions logged</div>
    </div>
    <div class="kpi ${highRisk > 0 ? 'alert' : ''}">
      <div class="val">${highRisk}</div>
      <div class="lbl">Collectors flagged high risk</div>
    </div>
    <div class="kpi ${openComplaints > 0 ? 'alert' : ''}">
      <div class="val">${openComplaints}</div>
      <div class="lbl">Open vendor complaints</div>
    </div>
  `;

  // Trend chart
  const ctx = document.getElementById('trendChart').getContext('2d');
  const labels = summary.byDay.map(d => d.day.slice(5));
  const totals = summary.byDay.map(d => d.total);
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Daily collection (SSP)',
        data: totals,
        borderColor: '#1f5f52',
        backgroundColor: 'rgba(31,95,82,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: v => (v/1000) + 'k' } },
        x: { ticks: { maxTicksLimit: 10 } },
      },
    },
  });

  // Variance table
  const vBody = document.querySelector('#varianceTable tbody');
  vBody.innerHTML = variance.map(v => `
    <tr>
      <td>${v.collector_name}</td>
      <td>${v.market_name}</td>
      <td class="num">${money(v.expected_daily)}</td>
      <td class="num">${money(v.avg_daily_last7)}</td>
      <td class="num" style="color:${v.variance_pct < 0 ? 'var(--risk)' : 'var(--ok)'}">${v.variance_pct > 0 ? '+' : ''}${v.variance_pct}%</td>
      <td>${flagLabel(v.flag)}</td>
    </tr>
  `).join('');

  // Market table
  const mBody = document.querySelector('#marketTable tbody');
  mBody.innerHTML = summary.byMarket.map(m => `
    <tr>
      <td>${m.name}</td>
      <td>${m.county}</td>
      <td class="num">${m.registered_vendor_count}</td>
      <td class="num">${money(m.standard_daily_fee)}</td>
      <td class="num">${m.txn_count.toLocaleString()}</td>
      <td class="num">${money(m.total_collected)}</td>
    </tr>
  `).join('');

  // Complaints
  const cPanel = document.getElementById('complaintsPanel');
  const open = complaints.filter(c => c.status === 'open');
  if (open.length === 0) {
    cPanel.innerHTML = '<div class="empty">No open complaints.</div>';
  } else {
    cPanel.innerHTML = open.map(c => `
      <div class="complaint">
        <div class="meta">
          <span>${c.vendor_name || 'Unknown vendor'} · ${c.market_name || ''}</span>
          <span>${new Date(c.created_at).toLocaleDateString()}</span>
        </div>
        <div class="msg">${c.message}</div>
        <button class="status-btn" data-id="${c.id}">Mark resolved</button>
      </div>
    `).join('');
    cPanel.querySelectorAll('.status-btn').forEach(btn => {
      btn.onclick = async () => {
        await fetch(`${API}/complaints/${btn.dataset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'resolved' }),
        });
        load();
      };
    });
  }
}

document.getElementById('refreshBtn').onclick = load;
load();
