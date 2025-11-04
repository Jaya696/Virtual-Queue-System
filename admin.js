// admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase, ref, onValue, set, get
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ======== YOUR FIREBASE CONFIG ========
const firebaseConfig = {
  apiKey: "AIzaSyBSPDes90ZSZgMm9cjFGe1DFlxKBPe24AE",
  authDomain: "virtual-queue-system-a1834.firebaseapp.com",
  databaseURL: "https://virtual-queue-system-a1834-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "virtual-queue-system-a1834",
  storageBucket: "virtual-queue-system-a1834.firebasestorage.app",
  messagingSenderId: "1081902069575",
  appId: "1:1081902069575:web:3e6d91288c8102c0743e62"
};
// =======================================

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const adminLocation = document.getElementById('admin-location');
const queueBody = document.getElementById('queue-body');
const callNextBtn = document.getElementById('callNextBtn');
const adminServingEl = document.getElementById('admin-serving');
const refreshBtn = document.getElementById('refreshBtn');
const peakCanvas = document.getElementById('peakChart');
const avgWaitEl = document.getElementById('avgWait');

let currentLocation = adminLocation.value;
let lastSnapshotData = {};
let historyUnsubscribe = null;
let peakChart = null;

// ---------------- UI wiring ----------------
adminLocation.addEventListener('change', () => {
  currentLocation = adminLocation.value;
  startQueueListener();
});

refreshBtn.addEventListener('click', () => {
  renderQueue(lastSnapshotData);
});

callNextBtn.addEventListener('click', async () => {
  const qRef = ref(db, `queues/${currentLocation}`);
  const snap = await get(qRef);
  const data = snap.val() || {};
  const arr = [];
  for (const k in data) {
    if (!data[k]) continue;
    const e = data[k];
    arr.push({ key: k, number: e.number, status: e.status });
  }

  const waiting = arr.filter(e => e.status === 'waiting').sort((a, b) => (a.number ?? 99999) - (b.number ?? 99999));
  if (waiting.length === 0) {
    alert('No waiting users');
    return;
  }

  // next is the item's key or number depending on how you store it
  const nextEntry = waiting[0];
  const nextKey = nextEntry.key;
  // update that entry -> set status called
  const entryRef = ref(db, `queues/${currentLocation}/${nextKey}`);
  await set(entryRef, { ...data[nextKey], status: 'called', number: nextEntry.number ?? data[nextKey].number ?? null, calledAt: new Date().toISOString() });

  // set serving pointer under queues/<location>/serving
  const servingRef = ref(db, `queues/${currentLocation}/serving`);
  await set(servingRef, { id: nextKey, number: nextEntry.number ?? data[nextKey].number ?? null, name: data[nextKey].name ?? null, startedAt: Date.now() });

  alert('Called entry ' + (nextEntry.number ?? nextKey));
});

// ---------------- Listeners ----------------
function startQueueListener() {
  // main queue node
  const qRef = ref(db, `queues/${currentLocation}`);
  onValue(qRef, (snap) => {
    const data = snap.val() || {};
    lastSnapshotData = data;
    renderQueue(data);
  });

  // serving pointer listener under queues/<location>/serving
  const servingRef = ref(db, `queues/${currentLocation}/serving`);
  onValue(servingRef, (s) => {
    const val = s.exists() ? s.val() : '-';
    // val may be object or number
    adminServingEl.textContent = (val && typeof val === 'object') ? (val.number ?? val.id ?? val.name ?? '-') : String(val);
  });

  // detach previous history listener if exists
  if (typeof historyUnsubscribe === 'function') {
    try { historyUnsubscribe(); } catch (e) { /* ignore */ }
    historyUnsubscribe = null;
  }

  // attach new history listener for analytics/chart
  const histRef = ref(db, `queues/${currentLocation}/history`);
  historyUnsubscribe = onValue(histRef, (hsnap) => {
    const hist = hsnap.val() || {};
    // pass queue name as second arg for fallback scan
    updateAnalyticsFromHistory(hist, currentLocation);
  });
}

// ---------------- Render queue table ----------------
function renderQueue(data) {
  const arr = [];
  for (const k in data) {
    if (!data[k]) continue;
    // skip system children
    if (k === 'history' || k === 'meta' || k === 'serving') continue;
    const e = data[k];
    arr.push({
      key: k,
      name: e.name || '',
      number: (e.number != null) ? e.number : (isFinite(parseInt(k)) ? parseInt(k) : null),
      status: e.status || 'waiting'
    });
  }

  arr.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  queueBody.innerHTML = '';

  for (const e of arr) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.number ?? '-'}</td>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.status)}</td>
      <td>
        ${e.status !== 'served' ? `<button data-key="${e.key}" class="btn btn-sm btn-primary mark-served">Mark Served</button>` : ''}
      </td>
    `;
    queueBody.appendChild(tr);
  }

  document.querySelectorAll('.mark-served').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const key = ev.target.getAttribute('data-key');
      if (!confirm(`Mark ${key} as served?`)) return;

      const entryRef = ref(db, `queues/${currentLocation}/${key}`);
      const now = Date.now();
      // read latest entry data
      const snap = await get(entryRef);
      const entry = snap.val() || {};
      await set(entryRef, { ...entry, status: 'served', servedAt: now });

      // update serving pointer to this served item (clear or set as desired)
      const servingRef = ref(db, `queues/${currentLocation}/serving`);
      await set(servingRef, null);

      // add to history (store served record)
      const historyRef = ref(db, `queues/${currentLocation}/history/${key}`);
      const record = {
        id: key,
        name: entry.name || null,
        number: entry.number ?? null,
        timestamp: entry.timestamp ?? entry.createdAt ?? entry.joinedAt ?? now,
        startedAt: entry.startedAt ?? entry.calledAt ? Date.parse(entry.calledAt) : null,
        servedAt: now
      };
      await set(historyRef, record);

      alert('Marked served: ' + (entry.number ?? key));
    });
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---------------- Analytics + Chart ----------------

// draw (or re-draw) the bar chart from counts array [24]
function drawPeakChart(counts) {
  const labels = counts.map((_, i) => `${i}:00`);
  if (peakChart) peakChart.destroy();
  peakChart = new Chart(peakCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Users Served Per Hour',
        data: counts,
        backgroundColor: 'rgba(54,162,235,0.6)',
        borderColor: 'rgba(54,162,235,1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
}

// Helper: build analytics from history object (preferred)
function buildFromHistoryObj(histObj) {
  const arr = Object.values(histObj || {});
  const waits = [];
  const counts = new Array(24).fill(0);
  arr.forEach(h => {
    const ts = h.timestamp ?? h.joinedAt ?? null;
    const start = h.startedAt ?? null;
    const servedAt = h.servedAt ?? start ?? null;

    // compute wait using startedAt - timestamp if possible, else servedAt - timestamp
    let waitMs = null;
    if (ts && start) waitMs = Math.max(0, start - ts);
    else if (ts && servedAt) waitMs = Math.max(0, servedAt - ts);

    if (waitMs != null) waits.push(waitMs);
    if (servedAt) {
      const hr = new Date(servedAt).getHours();
      counts[hr] = (counts[hr] || 0) + 1;
    }
  });
  return { waits, counts };
}

// Fallback: scan live queue node for items that are served
async function buildFromQueueFallback(queueName) {
  const snap = await get(ref(db, `queues/${queueName}`));
  const node = snap.val() || {};
  const waits = [];
  const counts = new Array(24).fill(0);
  Object.entries(node).forEach(([k, v]) => {
    if (!v || typeof v !== 'object') return;
    if (k === 'history' || k === 'meta' || k === 'serving') return;
    if (v.status === 'served' || v.status === 'called') {
      const ts = v.timestamp ?? v.joinedAt ?? null;
      const servedAt = v.servedAt ?? v.startedAt ?? null;
      if (ts && servedAt) {
        waits.push(Math.max(0, (v.startedAt || servedAt) - ts));
      }
      if (servedAt) {
        const hr = new Date(servedAt).getHours();
        counts[hr] = (counts[hr] || 0) + 1;
      }
    }
  });
  return { waits, counts };
}

// Main updater: prefer history, else fallback to scanning queue node
async function updateAnalyticsFromHistory(histObjOrNull, queueName) {
  let waits = [], counts = new Array(24).fill(0);

  if (histObjOrNull && Object.keys(histObjOrNull).length > 0) {
    const res = buildFromHistoryObj(histObjOrNull);
    waits = res.waits;
    counts = res.counts;
  } else {
    const res = await buildFromQueueFallback(queueName);
    waits = res.waits;
    counts = res.counts;
  }

  const avgMin = (waits.length) ? (waits.reduce((a,b)=>a+b,0) / waits.length) / 60000 : 0;
  avgWaitEl.textContent = avgMin ? (Math.round(avgMin * 10) / 10) + ' mins' : '—';

  drawPeakChart(counts);
}

// ---------------- Start ----------------
startQueueListener();
