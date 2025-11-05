

// admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase, ref, onValue, set
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ======== REPLACE WITH YOUR FIREBASE CONFIG ========
const firebaseConfig = {

  apiKey: "AIzaSyBSPDes90ZSZgMm9cjFGe1DFlxKBPe24AE",

  authDomain: "virtual-queue-system-a1834.firebaseapp.com",
  databaseURL: "https://virtual-queue-system-a1834-default-rtdb.asia-southeast1.firebasedatabase.app",


  projectId: "virtual-queue-system-a1834",

  storageBucket: "virtual-queue-system-a1834.firebasestorage.app",

  messagingSenderId: "1081902069575",

  appId: "1:1081902069575:web:3e6d91288c8102c0743e62"

};

// =================================================

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const adminLocation = document.getElementById('admin-location');
const queueBody = document.getElementById('queue-body');
const callNextBtn = document.getElementById('callNextBtn');
const adminServingEl = document.getElementById('admin-serving');
const refreshBtn = document.getElementById('refreshBtn');
const avgWaitEl = document.getElementById('avg-wait');
const waitChartCtx = document.getElementById('waitChart').getContext('2d');

let currentLocation = adminLocation.value;
let lastSnapshotData = {};
let waitChart = null;

// Listen to location change
adminLocation.addEventListener('change', () => {
  currentLocation = adminLocation.value;
  // reload listener
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
    // transform to array keyed by number if possible
    const arr = [];
    for (const k in data) {
      if (!data[k]) continue;
      const e = data[k];
      arr.push({ key: k, number: e.number, status: e.status });
    }
    const waiting = arr.filter(e => e.status === 'waiting').sort((a,b) => a.number - b.number);
    if (waiting.length === 0) {
      alert('No waiting users');
      return;
    }
    const next = waiting[0].number;
    const entryRef = ref(db, `queues/${currentLocation}/${next}`);
    await set(entryRef, { ...data[next], status: 'called', number: next, calledAt: new Date().toISOString() });
    const servingRef = ref(db, `serving/${currentLocation}`);
    await set(servingRef, next);
    alert('Called number ' + next);
  }, { onlyOnce: true });
});

// Start listener
function startQueueListener() {
  const qRef = ref(db, `queues/${currentLocation}`);
  onValue(qRef, (snap) => {
    const data = snap.val() || {};
    lastSnapshotData = data;
    renderQueue(data);
  });
  // serving pointer
  const servingRef = ref(db, `serving/${currentLocation}`);
  onValue(servingRef, (s) => {
    const serving = s.exists() ? s.val() : '-';
    adminServingEl.textContent = serving;
  });
}

// Compute waiting times from data
// Preference for timestamps: createdAt -> calledAt -> (skip if none).
// waitingMinutes = servedAt - createdAt/calledAt (in minutes)
function computeWaitingTimes(data) {
  const results = [];
  for (const k in data) {
    const e = data[k];
    if (!e || e.status !== 'served') continue;
    const servedAtStr = e.servedAt || e.served_at || e.served_at_iso;
    if (!servedAtStr) continue;
    const servedAt = Date.parse(servedAtStr);
    if (isNaN(servedAt)) continue;

    // prefer createdAt if available
    const createdAtStr = e.createdAt || e.created_at || e.enqueuedAt || e.enqueued_at;
    const calledAtStr = e.calledAt || e.called_at;
    let startTs = null;
    if (createdAtStr && !isNaN(Date.parse(createdAtStr))) {
      startTs = Date.parse(createdAtStr);
    } else if (calledAtStr && !isNaN(Date.parse(calledAtStr))) {
      startTs = Date.parse(calledAtStr);
    } else {
      // fallback: if there's an entry key that is numeric and that maybe time-based it's not useful; skip
      continue;
    }

    const diffMs = servedAt - startTs;
    const diffMin = diffMs / 60000; // minutes
    if (!isFinite(diffMin) || diffMin < 0) continue;
    results.push({
      number: e.number || parseInt(k) || null,
      servedAt,
      servedAtISO: new Date(servedAt).toISOString(),
      waitingMinutes: diffMin
    });
  }

  // sort by servedAt ascending
  results.sort((a,b) => a.servedAt - b.servedAt);
  return results;
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
  arr.sort((a,b) => a.number - b.number);
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
      const servingRef = ref(db, `serving/${currentLocation}`);
      await set(servingRef, parseInt(num));
      alert('Marked served: ' + num);
    });
  });

  // update waiting time chart
  try {
    const waitingData = computeWaitingTimes(data);
    updateWaitChart(waitingData);
  } catch (err) {
    console.error('Error computing waiting times:', err);
  }
}

// Chart creation / update
function createWaitChart() {
  if (waitChart) return;
  waitChart = new Chart(waitChartCtx, {
    type: 'line',
    data: {
      labels: [], // timestamps
      datasets: [
        {
          label: 'Waiting time (minutes)',
          data: [],
          fill: false,
          tension: 0.2,
          pointRadius: 4,
          borderWidth: 2
        },
        {
          label: 'Average (minutes)',
          data: [],
          type: 'line',
          borderDash: [6,4],
          tension: 0,
          pointRadius: 0,
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'YYYY-MM-DD HH:mm',
            displayFormats: {
              hour: 'MMM d, HH:mm',
              minute: 'HH:mm'
            }
          },
          title: { display: true, text: 'Served at' }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Minutes' }
        }
      },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.datasetIndex === 0) {
                return `${context.dataset.label}: ${Number(context.parsed.y).toFixed(1)} min`;
              } else {
                return `${context.dataset.label}: ${Number(context.parsed.y).toFixed(1)} min`;
              }
            }
          }
        }
      }
    }
  });
}

// Update chart with computed waiting data (array of {servedAt, servedAtISO, waitingMinutes})
function updateWaitChart(waitingData) {
  createWaitChart();

  // limit to last N points for readability
  const MAX_POINTS = 50;
  const pts = waitingData.slice(-MAX_POINTS);

  const labels = pts.map(p => p.servedAtISO);
  const values = pts.map(p => Number(p.waitingMinutes.toFixed(2)));

  // compute overall average (over all served entries)
  const allWaiting = waitingData.map(p => p.waitingMinutes);
  const avg = allWaiting.length ? (allWaiting.reduce((a,b)=>a+b,0)/allWaiting.length) : 0;

  // dataset 0 -> individual points
  waitChart.data.labels = labels;
  waitChart.data.datasets[0].data = values;

  // dataset 1 -> horizontal average line (repeat avg for each label position)
  const avgLine = labels.map(() => avg > 0 ? Number(avg.toFixed(2)) : null);
  waitChart.data.datasets[1].data = avgLine;

  waitChart.update();

  // display textual average
  avgWaitEl.textContent = allWaiting.length ? Number(avg.toFixed(2)) : '-';
}

// start initial listener
startQueueListener();
