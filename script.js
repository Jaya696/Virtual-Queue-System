// script.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase, ref, set, onValue, runTransaction, remove
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

// UI elements
const joinBtn = document.getElementById('joinBtn');
const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const locationSelect = document.getElementById('location');
const statusCard = document.getElementById('status-card');
const ticketNumberEl = document.getElementById('ticket-number');
const positionEl = document.getElementById('position');
const etaEl = document.getElementById('eta');
const currentServingEl = document.getElementById('current-serving');
const leaveBtn = document.getElementById('leaveBtn');

let myLocation = null;
let myNumber = null;
let unsubscribeListener = null;
const AVG_SERVICE_MINUTES = 1.5; // approximate average service time (minutes)

// Request notification permission
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}

// Join queue: transaction on counters/<location> to get a sequential number
joinBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const location = locationSelect.value;
  if (!name) return alert('Enter your name');

  const counterRef = ref(db, `counters/${location}`);
  try {
    const { committed, snapshot } = await runTransaction(counterRef, (current) => {
      return (current || 0) + 1;
    }, { applyLocally: true });

    if (!committed) return alert('Failed to join. Try again.');

    const assignedNumber = snapshot.val();
    const entryRef = ref(db, `queues/${location}/${assignedNumber}`);
    await set(entryRef, {
      name,
      phone: phone || '',
      number: assignedNumber,
      status: 'waiting',
     joinedAt: Date.now()
    });

    // Save local info
    myLocation = location;
    myNumber = assignedNumber;

    showStatusCard(assignedNumber);
    attachListener(location, assignedNumber);

    // simple UI feedback
    alert(`Joined queue. Your number: ${assignedNumber}`);
  } catch (e) {
    console.error(e);
    alert('Error joining queue. Check console.');
  }
});

// Show status and ticket
function showStatusCard(number) {
  ticketNumberEl.textContent = number;
  statusCard.style.display = 'block';
  document.getElementById('join-card').style.display = 'none';
}

// Leave queue
leaveBtn.addEventListener('click', async () => {
  if (!myLocation || !myNumber) return;
  const entryRef = ref(db, `queues/${myLocation}/${myNumber}`);
  await remove(entryRef);
  // optional: decrement not necessary
  cleanupAfterLeave();
});

function cleanupAfterLeave() {
  myLocation = null;
  myNumber = null;
  if (unsubscribeListener) unsubscribeListener();
  unsubscribeListener = null;
  statusCard.style.display = 'none';
  document.getElementById('join-card').style.display = 'block';
  ticketNumberEl.textContent = '';
  positionEl.textContent = '-';
  etaEl.textContent = '-';
  currentServingEl.textContent = '-';
}

// Listen for queue changes and compute position + ETA
function attachListener(location, assignedNumber) {
  const queueRef = ref(db, `queues/${location}`);
  const servingRef = ref(db, `serving/${location}`);

  // Listen for serving number changes
  onValue(servingRef, (sSnap) => {
    const serving = sSnap.exists() ? sSnap.val() : null;
    currentServingEl.textContent = serving === null ? '-' : serving;
    computePositionAndETAFromQueue(); // recalc when serving changes
  });

  // Listen for queue changes
  const offQueue = onValue(queueRef, (qSnap) => {
    computePositionAndETAFromQueue();
  });

  // store a cleanup function
  unsubscribeListener = () => {
    offQueue();
  };

  // Helper: compute pos + ETA
  function computePositionAndETAFromQueue() {
    const qRef = queueRef;
    onValue(qRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.values(data).map(e => ({ number: e.number, status: e.status }));
      onValue(servingRef, (s) => {
        const serving = s.exists() ? s.val() : null;
        currentServingEl.textContent = serving === null ? '-' : serving;
        if (!myNumber) return;
        let peopleAhead = 0;
        for (const e of arr) {
          if (e.number === undefined) continue;
          if (e.status === 'served') continue;
          if (serving !== null) {
            if (e.number > serving && e.number < myNumber) peopleAhead++;
          } else {
            if (e.number < myNumber && e.status !== 'served') peopleAhead++;
          }
        }
        const position = Math.max(0, peopleAhead);
        positionEl.textContent = position + 1;

        const mins = (position) * AVG_SERVICE_MINUTES;
        const minsText = mins < 1 ? `${Math.round(mins * 60)} sec` : `${Math.round(mins)} min`;
        etaEl.textContent = minsText;

        if (Notification && Notification.permission === 'granted') {
          if (serving !== null && (myNumber - serving) <= 2 && (myNumber - serving) > 0) {
            new Notification('Your turn is near', {
              body: `Current serving: ${serving}. Your number: ${myNumber}. Please get ready.`,
            });
          }
          if (serving !== null && myNumber === serving) {
            new Notification('Now Serving', {
              body: `Your number ${myNumber} is being served. Please come.`,
            });
          }
        }
      }, { onlyOnce: true });
    }, { onlyOnce: true });
  }
}
