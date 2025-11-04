// admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase, ref, onValue, set
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

let currentLocation = adminLocation.value;
let lastSnapshotData = {};

// Listen to location change
adminLocation.addEventListener('change', () => {
  currentLocation = adminLocation.value;
  startQueueListener();
});

// Refresh button
refreshBtn.addEventListener('click', () => {
  renderQueue(lastSnapshotData);
});

// Call Next
callNextBtn.addEventListener('click', async () => {
  const qRef = ref(db, `queues/${currentLocation}`);
  onValue(qRef, async (snap) => {
    const data = snap.val() || {};
    const arr = [];
    for (const k in data) {
      if (!data[k]) continue;
      const e = data[k];
      arr.push({ key: k, number: e.number, status: e.status });
    }

    const waiting = arr.filter(e => e.status === 'waiting').sort((a, b) => a.number - b.number);
    if (waiting.length === 0) {
      alert('No waiting users');
      return;
    }

    const next = waiting[0].number;
    const entryRef = ref(db, `queues/${currentLocation}/${next}`);
    await set(entryRef, { ...data[next], status: 'called', number: next, calledAt: new Date().toISOString() });

    // ✅ Fixed path for serving pointer
    const servingRef = ref(db, `queues/${currentLocation}/serving`);
    await set(servingRef, next);

    alert('Called number ' + next);
  }, { onlyOnce: true });
});

// Start listener
// ---------- REPLACE startQueueListener with this enhanced version ----------
let historyUnsubscribe = null; // will hold the onValue unsubscribe for history

function startQueueListener() {
  const qRef = ref(db, `queues/${currentLocation}`);
  // main items listener
  onValue(qRef, (snap) => {
    const data = snap.val() || {};
    lastSnapshotData = data;
    renderQueue(data);
  });

  // serving pointer listener (under queues/<location>/serving)
  const servingRef = ref(db, `queues/${currentLocation}/serving`);
  onValue(servingRef, (s) => {
    const serving = s.exists() ? s.val() : '-';
    adminServingEl.textContent = serving;
  });

  // detach previous history listener if exists
  if (typeof historyUnsubscribe === 'function') {
    try { historyUnsubscribe(); } catch(e) { /* ignore */ }
    historyUnsubscribe = null;
  }

  // attach new history listener for analytics/chart
  const histRef = ref(db, `queues/${currentLocation}/history`);
  historyUnsubscribe = onValue(histRef, (hsnap) => {
    const hist = hsnap.val() || {};
    updateAnalyticsFromHistory(hist);
  });
}
// ---------- Analytics + Chart helpers (paste after startQueueListener) ----------
let peakChart = null;
const peakCanvas = document.getElementById('peakChart');

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

// compute average wait and counts per hour from history object and update UI + chart
function updateAnalyticsFromHistory(historyObj) {
  const arr = Object.values(historyObj || {});

  // compute waiting times (use startedAt if present, otherwise servedAt)
  const waitMsArr = arr
    .map(h => {
      const join = h.timestamp || h.joinedAt || null;
      const start = h.startedAt || h.servedAt || null;
      return (join && start) ? Math.max(0, start - join) : null;
    })
    .filter(x => x != null);

  // average waiting time in minutes (1 decimal)
  const avgMin = waitMsArr.length ? (waitMsArr.reduce((a,b)=>a+b,0) / waitMsArr.length) / 60000 : 0;
  document.getElementById('avgWait').textContent = avgMin ? (Math.round(avgMin*10)/10) + ' mins' : '—';

  // served-per-hour counts (use servedAt or startedAt)
  const counts = new Array(24).fill(0);
  arr.forEach(h => {
    const servedAt = h.servedAt || h.startedAt || null;
    if (!servedAt) return;
    const hr = new Date(servedAt).getHours();
    if (typeof hr === 'number') counts[hr] = (counts[hr] || 0) + 1;
  });

  drawPeakChart(counts);
}


function renderQueue(data) {
  const arr = [];
  for (const k in data) {
    if (!data[k]) continue;
    const e = data[k];
    arr.push({
      key: k,
      name: e.name || '',
      number: e.number || (e.number === 0 ? 0 : parseInt(k) || 0),
      status: e.status || 'waiting'
    });
  }

  arr.sort((a, b) => a.number - b.number);
  queueBody.innerHTML = '';

  for (const e of arr) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.number}</td>
      <td>${e.name}</td>
      <td>${e.status}</td>
      <td>
        ${e.status !== 'served' ? `<button data-number="${e.number}" class="btn btn-sm btn-primary mark-served">Mark Served</button>` : ''}
      </td>
    `;
    queueBody.appendChild(tr);
  }

  document.querySelectorAll('.mark-served').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const num = ev.target.getAttribute('data-number');
      if (!confirm(`Mark ${num} as served?`)) return;

      const entryRef = ref(db, `queues/${currentLocation}/${num}`);
      const now = new Date().toISOString();
      await set(entryRef, { ...lastSnapshotData[num], status: 'served', servedAt: now, number: parseInt(num) });

      // ✅ Fixed serving pointer path
      const servingRef = ref(db, `queues/${currentLocation}/serving`);
      await set(servingRef, parseInt(num));

      alert('Marked served: ' + num);
    });
  });
}

// Start initial listener
startQueueListener();

