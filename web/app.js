// TripExpenses Web Companion
const firebaseConfig = {
  apiKey: "AIzaSyBknZDvToKhDpnJkUPos4Kf7MpAi_oqCxM",
  authDomain: "tripexpenses-64d08.firebaseapp.com",
  projectId: "tripexpenses-64d08",
  storageBucket: "tripexpenses-64d08.firebasestorage.app",
  messagingSenderId: "755996245972",
  appId: "1:755996245972:web:e8b1c45f35762d56ee6041",
  measurementId: "G-W0JXEB5G3W"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Initialize App Check with reCAPTCHA Enterprise
try {
  if (typeof firebase.appCheck === 'function') {
    const appCheck = firebase.appCheck();
    appCheck.activate(
      new firebase.appCheck.ReCaptchaEnterpriseProvider("6Lckgc4tAAAAANL4blmKZpeqmUqdszBsugvjNZli"),
      true
    );
  }
} catch (err) {
  console.warn("Firebase App Check init notice:", err);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Active Trip Context
let currentTripDocId = null;
let currentTripCode = null;
let currentTripData = null;

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

// Auth Elements
const googleSignInBtn = document.getElementById("googleSignInBtn");
const userProfile = document.getElementById("userProfile");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const signOutBtn = document.getElementById("signOutBtn");

// Modal Elements
const openAddExpenseBtn = document.getElementById("openAddExpenseBtn");
const addExpenseModal = document.getElementById("addExpenseModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelExpenseBtn = document.getElementById("cancelExpenseBtn");
const addExpenseForm = document.getElementById("addExpenseForm");
const expTitle = document.getElementById("expTitle");
const expAmount = document.getElementById("expAmount");
const expCurrency = document.getElementById("expCurrency");
const expCategory = document.getElementById("expCategory");
const expPaidBy = document.getElementById("expPaidBy");
const splitMembersList = document.getElementById("splitMembersList");
const modalError = document.getElementById("modalError");
const saveExpenseBtn = document.getElementById("saveExpenseBtn");

// Helper: UUID v4
function generateUUID() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Auth State Observer
auth.onAuthStateChanged((user) => {
  if (user && !user.isAnonymous) {
    if (googleSignInBtn) googleSignInBtn.classList.add("hidden");
    if (userProfile) userProfile.classList.remove("hidden");
    if (userName) userName.textContent = user.displayName || user.email || "Member";
    if (userAvatar) {
      if (user.photoURL) {
        userAvatar.src = user.photoURL;
        userAvatar.style.display = "block";
      } else {
        userAvatar.style.display = "none";
      }
    }
  } else {
    if (googleSignInBtn) googleSignInBtn.classList.remove("hidden");
    if (userProfile) userProfile.classList.add("hidden");
  }
});

// Google Sign-In Handler
if (googleSignInBtn) {
  googleSignInBtn.addEventListener("click", async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      console.warn("Popup sign-in error, falling back to redirect:", err);
      try {
        await auth.signInWithRedirect(provider);
      } catch (redirectErr) {
        alert("Sign-in failed: " + (err.message || redirectErr.message));
      }
    }
  });
}

// Sign-Out Handler
if (signOutBtn) {
  signOutBtn.addEventListener("click", async () => {
    try {
      await auth.signOut();
      await auth.signInAnonymously();
    } catch (err) {
      console.error("Sign-out error:", err);
    }
  });
}

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

// Active Trip Context & Real-Time Subscriptions
let currentTripDocId = null;
let currentTripCode = null;
let currentTripData = null;
let currentExpenses = [];
let currentSettlements = [];
let unsubscribeTrip = null;
let unsubscribeExpenses = null;
let unsubscribeSettlements = null;

function detachRealtimeListeners() {
  if (unsubscribeTrip) { unsubscribeTrip(); unsubscribeTrip = null; }
  if (unsubscribeExpenses) { unsubscribeExpenses(); unsubscribeExpenses = null; }
  if (unsubscribeSettlements) { unsubscribeSettlements(); unsubscribeSettlements = null; }
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
  detachRealtimeListeners();

  try {
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    // Direct lookup by doc ID (which matches invite code in our schema)
    let docSnap = null;
    let targetDocId = cleanCode;
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
          targetDocId = docSnap.id;
        }
      } catch (e) {
        console.warn("Query fallback error:", e);
      }
    }

    if (!docSnap || !docSnap.exists) {
      showError(`Trip with code "${cleanCode}" was not found or has not been published yet. Ask the trip host to open "Trip Members & Sharing" in their iPhone app to sync it to cloud.`);
      return;
    }

    currentTripDocId = targetDocId;
    currentTripCode = cleanCode;
    currentTripData = docSnap.data();

    renderTrip(targetDocId, currentTripData);
    loadingIndicator.classList.add("hidden");
    tripDashboard.classList.remove("hidden");
    window.location.hash = `/trip/${cleanCode}`;

    // 1. Real-time Trip Metadata Listener
    const tripRef = db.collection("trips").doc(targetDocId);
    unsubscribeTrip = tripRef.onSnapshot((snap) => {
      if (snap.exists) {
        currentTripData = snap.data();
        renderTrip(targetDocId, currentTripData);
        renderExpensesAndBalances(currentTripData, currentExpenses, currentSettlements);
      }
    }, (err) => console.warn("Trip metadata listener error:", err));

    // 2. Real-time Expenses Subcollection Listener
    const expensesRef = tripRef.collection("expenses");
    unsubscribeExpenses = expensesRef.onSnapshot((snap) => {
      currentExpenses = snap.docs.map(d => d.data());
      renderExpensesAndBalances(currentTripData, currentExpenses, currentSettlements);
    }, (err) => console.warn("Expenses listener error:", err));

    // 3. Real-time Settlements Subcollection Listener
    const settlementsRef = tripRef.collection("settlements");
    unsubscribeSettlements = settlementsRef.onSnapshot((snap) => {
      currentSettlements = snap.docs.map(d => d.data());
      renderExpensesAndBalances(currentTripData, currentExpenses, currentSettlements);
    }, (err) => console.warn("Settlements listener error:", err));

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

function renderExpensesAndBalances(trip, expenses = [], settlements = []) {
  if (!trip) return;
  const members = trip.members || [];
  const currency = trip.defaultCurrency || "AUD";

  // Calculate net balance for each member in trip base currency
  const balances = {};
  members.forEach(m => { balances[m] = 0.0; });

  expenses.forEach(exp => {
    const payer = exp.paidBy;
    const rawAmount = Number(exp.amount) || 0;
    const expCurr = exp.currency || currency;

    let effectiveRate = 1.0;
    if (expCurr !== currency) {
      effectiveRate = Number(exp.exchangeRateToAUD) > 0 ? Number(exp.exchangeRateToAUD) : 1.0;
    }
    const cost = rawAmount * effectiveRate;

    if (payer && balances[payer] !== undefined) {
      balances[payer] += cost;
    }

    if (exp.isItemizedSplit && exp.customSplitAmounts) {
      for (const [member, share] of Object.entries(exp.customSplitAmounts)) {
        if (balances[member] !== undefined) {
          balances[member] -= (Number(share) || 0) * effectiveRate;
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

  // Apply settlements to member balances
  settlements.forEach(s => {
    const amt = Number(s.amountAUD) || 0;
    if (s.fromMember && balances[s.fromMember] !== undefined) {
      balances[s.fromMember] += amt;
    }
    if (s.toMember && balances[s.toMember] !== undefined) {
      balances[s.toMember] -= amt;
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

  // If settlements exist, show Settled Debts subsection
  if (settlements.length > 0) {
    const settleHeader = document.createElement("div");
    settleHeader.style.cssText = "margin-top: 20px; margin-bottom: 8px; font-weight: 600; font-size: 0.9rem; color: var(--text-secondary);";
    settleHeader.textContent = "Settled Debts";
    membersBalanceList.appendChild(settleHeader);

    settlements.forEach(s => {
      const sDiv = document.createElement("div");
      sDiv.className = "balance-item";
      sDiv.style.opacity = "0.85";
      const sAmt = Number(s.amountAUD || 0).toFixed(2);
      sDiv.innerHTML = `
        <span class="balance-name">✓ ${escapeHTML(s.fromMember)} → ${escapeHTML(s.toMember)}</span>
        <span class="balance-val val-zero">${escapeHTML(sAmt)} AUD</span>
      `;
      membersBalanceList.appendChild(sDiv);
    });
  }

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

// Modal Controls & Expense Creation
function openModal() {
  if (!currentTripData) return;
  modalError.classList.add("hidden");
  expTitle.value = "";
  expAmount.value = "";

  // Populate Currencies
  expCurrency.innerHTML = "";
  const baseCurr = currentTripData.defaultCurrency || "AUD";
  const common = [baseCurr, "AUD", "USD", "EUR", "GBP", "JPY", "NZD", "SGD", "THB", "IDR"];
  const uniqueCurrs = Array.from(new Set(common));
  uniqueCurrs.forEach(curr => {
    const opt = document.createElement("option");
    opt.value = curr;
    opt.textContent = curr;
    expCurrency.appendChild(opt);
  });
  expCurrency.value = baseCurr;

  // Populate PaidBy
  expPaidBy.innerHTML = "";
  const members = currentTripData.members || [];
  members.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    expPaidBy.appendChild(opt);
  });

  // Default PaidBy to signed-in user name if matching, or first member
  const currentUser = auth.currentUser;
  if (currentUser && currentUser.displayName) {
    const match = members.find(m => m.toLowerCase() === currentUser.displayName.toLowerCase());
    if (match) expPaidBy.value = match;
  }

  // Populate Split Checkboxes
  splitMembersList.innerHTML = "";
  members.forEach(m => {
    const label = document.createElement("label");
    label.className = "checkbox-label";
    label.innerHTML = `
      <input type="checkbox" name="splitMember" value="${escapeHTML(m)}" checked />
      <span>${escapeHTML(m)}</span>
    `;
    splitMembersList.appendChild(label);
  });

  addExpenseModal.classList.remove("hidden");
  setTimeout(() => expTitle.focus(), 100);
}

function closeModal() {
  addExpenseModal.classList.add("hidden");
}

if (openAddExpenseBtn) openAddExpenseBtn.addEventListener("click", openModal);
if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
if (cancelExpenseBtn) cancelExpenseBtn.addEventListener("click", closeModal);

if (addExpenseModal) {
  addExpenseModal.addEventListener("click", (e) => {
    if (e.target === addExpenseModal) {
      closeModal();
    }
  });
}

// Save Expense
if (addExpenseForm) {
  addExpenseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    modalError.classList.add("hidden");

    const title = expTitle.value.trim();
    const amount = parseFloat(expAmount.value);
    const currency = expCurrency.value;
    const category = expCategory.value;
    const paidBy = expPaidBy.value;

    if (!title) {
      modalError.textContent = "Please enter an expense description.";
      modalError.classList.remove("hidden");
      return;
    }

    if (isNaN(amount) || amount <= 0 || amount > 1000000000) {
      modalError.textContent = "Please enter a valid amount between 0.01 and 1,000,000,000.";
      modalError.classList.remove("hidden");
      return;
    }

    // Get selected split members
    const checkedBoxes = splitMembersList.querySelectorAll("input[type='checkbox']:checked");
    const splitForMembers = Array.from(checkedBoxes).map(cb => cb.value);

    if (splitForMembers.length === 0) {
      modalError.textContent = "Please select at least one person to split this expense with.";
      modalError.classList.remove("hidden");
      return;
    }

    saveExpenseBtn.disabled = true;
    saveExpenseBtn.textContent = "Saving...";

    try {
      if (!auth.currentUser) {
        await auth.signInAnonymously();
      }

      const newExpId = generateUUID();
      const user = auth.currentUser;
      const createdBy = (user && !user.isAnonymous) ? (user.displayName || user.email || "Web User") : (paidBy || "Web User");

      // Fetch live exchange rate if currency is not AUD (bounded with 3.5s timeout)
      let exchangeRateToAUD = 1.0;
      if (currency !== "AUD") {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const rateRes = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=AUD`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (rateRes.ok) {
            const rateData = await rateRes.json();
            if (rateData && rateData.rates && typeof rateData.rates.AUD === "number") {
              exchangeRateToAUD = rateData.rates.AUD;
            }
          }
        } catch (fxErr) {
          console.warn("Could not fetch Frankfurter rate for " + currency + ", defaulting to 1.0:", fxErr);
        }
      }

      const newExpenseData = {
        id: newExpId,
        title: title,
        amount: amount,
        currency: currency,
        exchangeRateToAUD: exchangeRateToAUD,
        category: category,
        paymentMethod: "Cash / Individual Card",
        paidBy: paidBy,
        jointPayers: [],
        splitForMembers: splitForMembers,
        participants: splitForMembers,
        isItemizedSplit: false,
        date: firebase.firestore.Timestamp.now(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: createdBy,
        notes: "Logged via TripExpenses Web Companion"
      };

      await db.collection("trips").doc(currentTripDocId).collection("expenses").doc(newExpId).set(newExpenseData);

      closeModal();
    } catch (err) {
      console.error("Save expense error:", err);
      modalError.textContent = "Failed to save: " + (err.message || "Permission error");
      modalError.classList.remove("hidden");
    } finally {
      saveExpenseBtn.disabled = false;
      saveExpenseBtn.textContent = "Save Expense";
    }
  });
}

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
