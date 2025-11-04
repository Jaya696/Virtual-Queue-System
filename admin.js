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
function startQueueListener() {
  const qRef = ref(db, `queues/${currentLocation}`);
  onValue(qRef, (snap) => {
    const data = snap.val() || {};
    lastSnapshotData = data;
    renderQueue(data);
  });

  // ✅ Fixed serving pointer listener path
  const servingRef = ref(db, `queues/${currentLocation}/serving`);
  onValue(servingRef, (s) => {
    const serving = s.exists() ? s.val() : '-';
    adminServingEl.textContent = serving;
  });
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

