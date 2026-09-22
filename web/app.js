// TripExpenses Web Companion
const firebaseConfig = {
  apiKey: "AIzaSyAvoFWzrDrwgtVdL3wx0RxjcGb9l1FO5-w",
  authDomain: "tripexpenses-64d08.firebaseapp.com",
  projectId: "tripexpenses-64d08",
  storageBucket: "tripexpenses-64d08.firebasestorage.app",
  messagingSenderId: "755996245972",
  appId: "1:755996245972:ios:2aaafd15c4fcca4dee6041"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// UI Elements
const codeInput = document.getElementById("codeInput");
const loadTripBtn = document.getElementById("loadTripBtn");
const loadingIndicator = document.getElementById("loadingIndicator");
const errorCard = document.getElementById("errorCard");
const errorMessage = document.getElementById("errorMessage");
const tripDashboard = document.getElementById("tripDashboard");

const tripEmoji = document.getElementById("tripEmoji");
const tripTitle = document.getElementById("tripTitle");
const tripCurrency = document.getElementById("tripCurrency");
const membersBalanceList = document.getElementById("membersBalanceList");
const expensesList = document.getElementById("expensesList");

// Tab Switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

function escapeHTML(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function showError(msg) {
  loadingIndicator.classList.add("hidden");
  tripDashboard.classList.add("hidden");
  errorCard.classList.remove("hidden");
  errorMessage.textContent = msg;
}

function clearError() {
  errorCard.classList.add("hidden");
}

async function loadTrip(code) {
  const cleanCode = code.trim().toUpperCase();
  if (cleanCode.length < 4) {
    showError("Please enter a valid trip invite code.");
    return;
  }

  clearError();
  loadingIndicator.classList.remove("hidden");
  tripDashboard.classList.add("hidden");

  try {
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    // Direct lookup by doc ID (which matches invite code in our schema)
    let docSnap = null;
    try {
      docSnap = await db.collection("trips").doc(cleanCode).get();
    } catch (e) {
      console.warn("Direct doc get error:", e);
    }

    // Fallback: query inviteCode field
    if (!docSnap || !docSnap.exists) {
      try {
        const querySnap = await db.collection("trips").where("inviteCode", "==", cleanCode).limit(1).get();
        if (!querySnap.empty) {
          docSnap = querySnap.docs[0];
        }
      } catch (e) {
        console.warn("Query fallback error:", e);
      }
    }

    if (!docSnap || !docSnap.exists) {
      showError(`Trip with code "${cleanCode}" was not found or has not been published yet. Ask the trip host to open "Trip Members & Sharing" in their iPhone app to sync it to cloud.`);
      return;
    }

    const tripData = docSnap.data();
    renderTrip(docSnap.id, tripData);

    // Fetch itemized subcollection expenses
    let expenses = [];
    try {
      const expSnap = await db.collection("trips").doc(docSnap.id).collection("expenses").get();
      expenses = expSnap.docs.map(d => d.data());
    } catch (expErr) {
      console.warn("Could not load expenses subcollection:", expErr);
    }

    renderExpensesAndBalances(tripData, expenses);

    loadingIndicator.classList.add("hidden");
    tripDashboard.classList.remove("hidden");

    // Update URL hash for easy sharing
    window.location.hash = `/trip/${cleanCode}`;
  } catch (err) {
    console.error(err);
    if (err.code === "permission-denied" || (err.message && err.message.includes("permission"))) {
      showError(`Could not load trip: Missing or insufficient permissions. Please verify Firestore security rules in the Firebase Console.`);
    } else {
      showError("Could not load trip: " + (err.message || "Network error."));
    }
  }
}

function renderTrip(docId, trip) {
  tripTitle.textContent = trip.title || "Trip";
  tripEmoji.textContent = trip.flagEmoji || "✈️";
  tripCurrency.textContent = trip.defaultCurrency || "AUD";
}

function renderExpensesAndBalances(trip, expenses) {
  const members = trip.members || [];
  const currency = trip.defaultCurrency || "AUD";

  // Calculate net balance for each member
  const balances = {};
  members.forEach(m => { balances[m] = 0.0; });

  expenses.forEach(exp => {
    const payer = exp.paidBy;
    const cost = exp.amount || 0;

    if (payer && balances[payer] !== undefined) {
      balances[payer] += cost;
    }

    if (exp.isItemizedSplit && exp.customSplitAmounts) {
      for (const [member, share] of Object.entries(exp.customSplitAmounts)) {
        if (balances[member] !== undefined) {
          balances[member] -= Number(share);
        }
      }
    } else {
      const split = exp.splitForMembers && exp.splitForMembers.length > 0 ? exp.splitForMembers : members;
      const perPerson = split.length > 0 ? (cost / split.length) : 0;
      split.forEach(m => {
        if (balances[m] !== undefined) {
          balances[m] -= perPerson;
        }
      });
    }
  });

  // Render Balances
  membersBalanceList.innerHTML = "";
  members.forEach(member => {
    const net = balances[member] || 0;
    const div = document.createElement("div");
    div.className = "balance-item";

    let valClass = "val-zero";
    let formatted = "$0.00";
    if (net > 0.01) {
      valClass = "val-positive";
      formatted = `+${currency} $${net.toFixed(2)}`;
    } else if (net < -0.01) {
      valClass = "val-negative";
      formatted = `-${currency} $${Math.abs(net).toFixed(2)}`;
    }

    div.innerHTML = `
      <span class="balance-name">${escapeHTML(member)}</span>
      <span class="balance-val ${valClass}">${escapeHTML(formatted)}</span>
    `;
    membersBalanceList.appendChild(div);
  });

  // Render Expenses
  expensesList.innerHTML = "";
  if (expenses.length === 0) {
    expensesList.innerHTML = `<p class="hint-text" style="text-align: center; padding: 16px 0;">No expenses logged in this trip yet.</p>`;
    return;
  }

  // Sort by date desc
  expenses.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));

  expenses.forEach(exp => {
    const div = document.createElement("div");
    div.className = "expense-item";
    const title = exp.title || "Expense";
    const amount = Number(exp.amount || 0).toFixed(2);
    const curr = exp.currency || currency;
    const paidBy = exp.paidBy || "Unknown";
    const category = exp.category || "General";

    div.innerHTML = `
      <div>
        <div class="expense-title">${escapeHTML(title)}</div>
        <div class="expense-subtitle">${escapeHTML(category)} • Paid by ${escapeHTML(paidBy)}</div>
      </div>
      <div class="expense-amount">${escapeHTML(amount)} ${escapeHTML(curr)}</div>
    `;
    expensesList.appendChild(div);
  });
}

// Handlers
loadTripBtn.addEventListener("click", () => {
  loadTrip(codeInput.value);
});

codeInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    loadTrip(codeInput.value);
  }
});

// Auto-load code from URL if present (?code=ABC or #/trip/ABC)
window.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const queryCode = urlParams.get("code");
  const queryMember = urlParams.get("member");
  const hash = window.location.hash;
  const hashMatch = hash.match(/\/trip\/([A-Za-z0-9]+)/);

  const initialCode = queryCode || (hashMatch ? hashMatch[1] : null);
  if (initialCode) {
    codeInput.value = initialCode.toUpperCase();
    loadTrip(initialCode);

    const isRealIOS = (/iPhone|iPod/.test(navigator.userAgent) || 
                      (/iPad/.test(navigator.userAgent) && !/Macintosh/.test(navigator.userAgent)) || 
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/Macintosh/.test(navigator.userAgent))) && 
                      !window.MSStream;

    const iosBanner = document.getElementById("iosBanner");
    const openAppBtn = document.getElementById("openAppBtn");
    if (iosBanner && openAppBtn && isRealIOS) {
      let deepLink = `tripexpenses://join?code=${encodeURIComponent(initialCode.toUpperCase())}`;
      if (queryMember) {
        deepLink += `&member=${encodeURIComponent(queryMember)}`;
      }
      openAppBtn.href = deepLink;
      iosBanner.style.display = "block";
    }
  }
});
