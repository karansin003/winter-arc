import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const ARC_START = "2026-10-01";
const ARC_END = "2026-12-29";
const ARC_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const CORE_HABITS = [
  { id: "physical", name: "Physical", detail: "45-60 min intense training + 10k steps" },
  { id: "nutrition", name: "Nutrition", detail: "No junk food or sugar + 3-4L water" },
  { id: "sleep", name: "Sleep", detail: "Sleep by 10:00 PM + wake by 5:00 AM" },
  { id: "mind", name: "Mind", detail: "Read 10 pages + max 30 min social media" },
  { id: "focus", name: "Focus", detail: "2+ hours of deep, uninterrupted work or study" }
];
const QUOTES = [
  "Discipline is keeping a promise to yourself when nobody else is watching.",
  "You do not need a new plan. You need to keep the one you made.",
  "The work counts most on the days you would rather skip it.",
  "Small actions, repeated daily, become a different life.",
  "Do it tired. Do it quietly. Let the results make the noise.",
  "Your future is built by what you finish today.",
  "Motivation starts the race. Consistency gets you across the line.",
  "Make the next choice a vote for the person you want to become."
];
const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const setupNote = document.querySelector("#setup-note");
const content = document.querySelector("#app-content");
let auth;
let db;
let user = null;
let unsubscribeState = null;
let saveTimer;
let authMode = "signin";
let activeTab = "today";
let selectedDate = todayKey();
let state = initialState();

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function todayKey() { return dateKey(new Date()); }
function parseDate(key) { return new Date(`${key}T00:00:00`); }
function addDays(key, amount) {
  const date = parseDate(key);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}
function clampDate(key) { return key < ARC_START ? ARC_START : key > ARC_END ? ARC_END : key; }
function initialState() { return { habits: structuredClone(CORE_HABITS), logs: {}, journal: {} }; }
function normalizeState(value) {
  if (!value || typeof value !== "object") return initialState();
  const defaults = initialState();
  const habits = Array.isArray(value.habits) ? value.habits.filter(h => h && typeof h.id === "string" && typeof h.name === "string") : defaults.habits;
  return {
    habits,
    logs: value.logs && typeof value.logs === "object" ? value.logs : {},
    journal: value.journal && typeof value.journal === "object" ? value.journal : {}
  };
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function completedCount(day) {
  const log = state.logs[day] || {};
  return state.habits.filter(habit => log[habit.id] === true).length;
}
function isPerfect(day) { return state.habits.length > 0 && completedCount(day) === state.habits.length; }
function isPastOrToday(day) { return day <= todayKey() && day >= ARC_START; }
function dayPercent(day) {
  return state.habits.length ? Math.round(completedCount(day) / state.habits.length * 100) : 0;
}
function currentStreak() {
  const today = clampDate(todayKey());
  let cursor = today;
  if (cursor === todayKey() && !isPerfect(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (cursor >= ARC_START && isPerfect(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
function localCacheKey() { return user ? `winter-arc:${user.uid}` : ""; }
function showMessage(message, error = false) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  if (error) toast.style.borderColor = "var(--orange)";
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}
function getSelectedLabel() {
  return parseDate(selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function updateCountdown() {
  const target = new Date(2027, 0, 1, 0, 0, 0, 0).getTime();
  const start = parseDate(ARC_START).getTime();
  const arcEnd = parseDate(addDays(ARC_END, 1)).getTime();
  const remaining = Math.max(0, target - Date.now());
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor(remaining % DAY_MS / (60 * 60 * 1000));
  const minutes = Math.floor(remaining % (60 * 60 * 1000) / (60 * 1000));
  const percent = Math.max(0, Math.min(100, (Date.now() - start) / (arcEnd - start) * 100));
  document.querySelector("#count-days").textContent = String(days).padStart(2, "0");
  document.querySelector("#count-hours").textContent = String(hours).padStart(2, "0");
  document.querySelector("#count-minutes").textContent = String(minutes).padStart(2, "0");
  document.querySelector("#global-percent").textContent = `${Math.floor(percent)}%`;
  document.querySelector("#global-bar").style.width = `${percent}%`;
  document.querySelector("#countdown-label").textContent = remaining ? "COUNTDOWN TO JAN 01" : "THE ARC IS COMPLETE";
}

function renderToday() {
  const date = selectedDate;
  const percent = dayPercent(date);
  const count = completedCount(date);
  const circumference = 2 * Math.PI * 35;
  const offset = circumference * (1 - percent / 100);
  const canEdit = isPastOrToday(date);
  const habits = state.habits.length ? state.habits.map(habit => {
    const checked = (state.logs[date] || {})[habit.id] === true;
    return `<label class="habit-row ${checked ? "done habit-done" : ""}">
      <input class="habit-check" type="checkbox" data-habit-check="${escapeHtml(habit.id)}" ${checked ? "checked" : ""} ${canEdit ? "" : "disabled"}>
      <span class="habit-copy"><span class="habit-name">${escapeHtml(habit.name)}</span><span class="habit-detail">${escapeHtml(habit.detail || "")}</span></span>
    </label>`;
  }).join("") : `<div class="empty">No rules yet. Add your first one in My rules.</div>`;
  const quoteSeed = [...date].reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 7);
  const quoteIndex = quoteSeed % QUOTES.length;
  return `<div class="content-heading"><div><p class="eyebrow">DAILY CHECK-IN</p><h2>${date === todayKey() ? "Today's execution" : "Daily execution"}</h2></div><span class="date-label">${escapeHtml(getSelectedLabel())}</span></div>
    <div class="today-grid">
      <section class="panel panel-pad"><p class="panel-kicker">NON-NEGOTIABLES · ${count}/${state.habits.length}</p><h3 class="panel-title">Keep the promises you made.</h3><div class="habit-list">${habits}</div></section>
      <div class="side-stack"><section class="panel panel-pad progress-panel"><svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${percent}% complete"><circle class="track" cx="42" cy="42" r="35"></circle><circle class="value" cx="42" cy="42" r="35" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 42 42)"></circle><text x="42" y="47" text-anchor="middle">${percent}%</text></svg><div class="progress-copy"><strong>${percent === 100 ? "A perfect day." : `${count} of ${state.habits.length} complete`}</strong><span>${canEdit ? "One checked promise at a time." : "Future day · checklist is locked."}</span></div></section>
      <section class="panel panel-pad quote-panel"><div><p class="panel-kicker">TODAY'S REMINDER</p><p class="quote">“${escapeHtml(QUOTES[quoteIndex])}”</p></div></section></div>
    </div><section class="panel streak-panel"><div><span class="panel-kicker">CURRENT STREAK</span><strong>${currentStreak()} <span class="streak-flame">🔥</span></strong></div><span>Consecutive perfect days</span></section>`;
}

function renderCalendar() {
  const days = Array.from({ length: ARC_DAYS }, (_, index) => addDays(ARC_START, index));
  const cells = days.map((day, index) => {
    const done = completedCount(day);
    const future = day > todayKey();
    const status = isPerfect(day) ? "complete" : done ? "partial" : "";
    const label = `Day ${index + 1}, ${day}, ${isPerfect(day) ? "complete" : done ? `${dayPercent(day)} percent complete` : future ? "future" : "not started"}`;
    return `<button type="button" class="calendar-day ${status} ${future ? "future" : ""} ${selectedDate === day ? "selected" : ""}" data-select-day="${day}" aria-label="${label}" title="${label}">${index + 1}</button>`;
  }).join("");
  return `<div class="content-heading"><div><p class="eyebrow">OCT 01 — DEC 29</p><h2>Your 90 days</h2></div><span class="date-label">Select a day to open its checklist</span></div>
    <section class="panel panel-pad"><div class="calendar-grid">${cells}</div><div class="calendar-legend"><span class="legend-item"><i class="legend-swatch complete"></i>All done</span><span class="legend-item"><i class="legend-swatch partial"></i>Partially done</span><span class="legend-item"><i class="legend-swatch"></i>Not done / future</span></div></section>
    <section class="panel panel-pad selected-day"><div class="content-heading"><div><p class="panel-kicker">SELECTED DAY</p><h2>${escapeHtml(getSelectedLabel())}</h2></div><button class="small-button" type="button" data-action="open-today">Open checklist</button></div><p class="muted">${completedCount(selectedDate)} of ${state.habits.length} rules completed · ${dayPercent(selectedDate)}%</p></section>`;
}

function renderHabits() {
  const items = state.habits.map(habit => `<div class="rule-item"><div><strong>${escapeHtml(habit.name)}</strong><p>${escapeHtml(habit.detail || "")}</p></div><div class="rule-actions"><button type="button" class="small-button" data-action="edit-habit" data-id="${escapeHtml(habit.id)}">Edit</button><button type="button" class="small-button danger" data-action="delete-habit" data-id="${escapeHtml(habit.id)}">Delete</button></div></div>`).join("");
  return `<div class="content-heading"><div><p class="eyebrow">MAKE IT YOURS</p><h2>Your non-negotiables</h2></div></div><section class="panel panel-pad"><p class="muted">A rule is complete when you have kept the whole promise for that pillar.</p><form id="rule-form" class="rule-form"><input name="name" maxlength="48" placeholder="Rule name" aria-label="Rule name" required><input name="detail" maxlength="140" placeholder="What does done look like?" aria-label="Rule details"><button class="button button-primary" type="submit">Add rule +</button></form><div>${items || `<div class="empty">No rules. Add one above to get started.</div>`}</div></section>`;
}

function renderJournal() {
  const entry = state.journal[selectedDate] || "";
  return `<div class="content-heading"><div><p class="eyebrow">ONE LINE, NO FILTER</p><h2>Daily reflection</h2></div><span class="date-label">${escapeHtml(getSelectedLabel())}</span></div><section class="panel panel-pad"><label class="panel-kicker" for="journal-entry">WHAT WAS YOUR WIN TODAY?</label><textarea id="journal-entry" class="journal-input" maxlength="280" placeholder="One win. One lesson. One honest sentence." ${isPastOrToday(selectedDate) ? "" : "disabled"}>${escapeHtml(entry)}</textarea><div id="journal-status" class="journal-status">${isPastOrToday(selectedDate) ? "Saved privately to your account." : "Future day · journal is locked."}</div></section><p class="muted">Your journal is private to your signed-in account and synced to your Firebase profile.</p>`;
}

function renderProfile() {
  const createdAt = user?.metadata?.creationTime;
  const memberSince = createdAt ? new Date(createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";
  return `<div class="content-heading"><div><p class="eyebrow">YOUR ACCOUNT</p><h2>Profile</h2></div></div>
    <section class="panel panel-pad profile-panel"><form id="profile-form" class="profile-form"><label for="profile-name">Name</label><input id="profile-name" name="name" type="text" maxlength="80" autocomplete="name" value="${escapeHtml(user?.displayName || "")}" placeholder="Your name" required><div class="profile-meta"><div><span>EMAIL</span><strong>${escapeHtml(user?.email || "—")}</strong></div><div><span>MEMBER SINCE</span><strong>${escapeHtml(memberSince)}</strong></div></div><button class="button button-primary" type="submit">Save profile</button></form>
    <div class="profile-security"><div><strong>Password</strong><p class="muted">Forgot your password? Send a reset link to your account email.</p></div><button class="small-button" type="button" data-action="profile-reset">Send reset link</button></div></section>`;
}

function render() {
  document.querySelectorAll(".tab").forEach(tab => {
    const active = tab.dataset.tab === activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  content.innerHTML = ({ today: renderToday, calendar: renderCalendar, habits: renderHabits, journal: renderJournal, profile: renderProfile })[activeTab]();
}

function cacheAndSync() {
  if (!user) return;
  try { localStorage.setItem(localCacheKey(), JSON.stringify(state)); } catch { showMessage("Browser storage is unavailable.", true); }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await setDoc(doc(db, "users", user.uid, "winterArc", "state"), { state, updatedAt: serverTimestamp() });
    } catch (error) {
      showMessage(`Cloud save failed: ${error.message}`, true);
    }
  }, 350);
}

function startUserData(currentUser) {
  if (unsubscribeState) unsubscribeState();
  const cacheKey = `winter-arc:${currentUser.uid}`;
  const stateRef = doc(db, "users", currentUser.uid, "winterArc", "state");
  let firstSnapshot = true;
  unsubscribeState = onSnapshot(stateRef, snapshot => {
    if (snapshot.exists() && snapshot.data().state) {
      state = normalizeState(snapshot.data().state);
      try { localStorage.setItem(cacheKey, JSON.stringify(state)); } catch {}
    } else if (firstSnapshot) {
      try {
        const cached = localStorage.getItem(cacheKey);
        state = cached ? normalizeState(JSON.parse(cached)) : initialState();
      } catch { state = initialState(); }
      cacheAndSync();
    }
    firstSnapshot = false;
    render();
  }, error => showMessage(`Could not load your data: ${error.message}`, true));
}

function updateAuthMode() {
  const create = authMode === "create";
  const nameField = document.querySelector("#display-name-field");
  document.querySelector("#auth-title").textContent = create ? "Create account" : "Sign in";
  document.querySelector("#auth-description").textContent = create ? "Your habits and journal sync privately across devices." : "Pick up exactly where you left off.";
  document.querySelector("#auth-submit").innerHTML = `${create ? "Create account" : "Sign in"} <span aria-hidden="true">↗</span>`;
  document.querySelector("#auth-switch").textContent = create ? "Already have an account? Sign in" : "Create an account";
  document.querySelector("#password").autocomplete = create ? "new-password" : "current-password";
  nameField.hidden = !create;
  document.querySelector("#display-name").required = create;
  authMessage.textContent = "";
}

function firebaseReady() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_") && firebaseConfig.authDomain && !firebaseConfig.authDomain.startsWith("YOUR_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("YOUR_") && firebaseConfig.appId && !firebaseConfig.appId.startsWith("YOUR_");
}

function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email. Sign in instead.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Try again in a little while.",
    "auth/network-request-failed": "Network error. Check your internet connection."
  };
  return messages[error.code] || error.message;
}

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!auth) return;
  const email = authForm.email.value.trim();
  const password = authForm.password.value;
  const displayName = document.querySelector("#display-name").value.trim();
  authMessage.textContent = "Working...";
  try {
    if (authMode === "create") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
      document.querySelector("#account-email").textContent = displayName;
    } else await signInWithEmailAndPassword(auth, email, password);
    authForm.reset();
  } catch (error) { authMessage.textContent = friendlyAuthError(error); }
});
document.querySelector("#auth-switch").addEventListener("click", () => {
  authMode = authMode === "signin" ? "create" : "signin";
  updateAuthMode();
});
document.querySelector("#reset-password").addEventListener("click", async () => {
  const email = authForm.email.value.trim();
  if (!auth || !email) { authMessage.textContent = "Enter your email first, then request a reset link."; return; }
  try { await sendPasswordResetEmail(auth, email); authMessage.textContent = "Password reset email sent."; }
  catch (error) { authMessage.textContent = friendlyAuthError(error); }
});
document.querySelector("#sign-out").addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (error) { showMessage(`Sign out failed: ${friendlyAuthError(error)}`, true); }
});
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  activeTab = tab.dataset.tab;
  render();
}));

content.addEventListener("change", event => {
  const checkbox = event.target.closest("[data-habit-check]");
  if (!checkbox || !isPastOrToday(selectedDate)) return;
  state.logs[selectedDate] ||= {};
  state.logs[selectedDate][checkbox.dataset.habitCheck] = checkbox.checked;
  cacheAndSync();
  render();
});
content.addEventListener("click", async event => {
  const dayButton = event.target.closest("[data-select-day]");
  if (dayButton) {
    selectedDate = dayButton.dataset.selectDay;
    render();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "open-today") { activeTab = "today"; render(); }
  if (action.dataset.action === "profile-reset") {
    if (!user?.email) { showMessage("This account has no email address for password reset.", true); return; }
    try {
      await sendPasswordResetEmail(auth, user.email);
      showMessage(`Password reset link sent to ${user.email}.`);
    } catch (error) { showMessage(friendlyAuthError(error), true); }
  }
  if (action.dataset.action === "delete-habit") {
    const habit = state.habits.find(item => item.id === action.dataset.id);
    if (habit && window.confirm(`Delete “${habit.name}” and its completion history?`)) {
      state.habits = state.habits.filter(item => item.id !== habit.id);
      Object.values(state.logs).forEach(log => delete log[habit.id]);
      cacheAndSync();
      render();
    }
  }
  if (action.dataset.action === "edit-habit") {
    const habit = state.habits.find(item => item.id === action.dataset.id);
    if (!habit) return;
    const name = window.prompt("Rule name", habit.name);
    if (name === null || !name.trim()) return;
    const detail = window.prompt("What does done look like?", habit.detail || "");
    if (detail === null) return;
    habit.name = name.trim();
    habit.detail = detail.trim();
    cacheAndSync();
    render();
  }
});
content.addEventListener("submit", async event => {
  event.preventDefault();
  if (event.target.id === "profile-form") {
    const name = String(new FormData(event.target).get("name") || "").trim();
    if (!name || !auth.currentUser) return;
    try {
      await updateProfile(auth.currentUser, { displayName: name });
      document.querySelector("#account-email").textContent = name;
      showMessage("Profile saved.");
      render();
    } catch (error) { showMessage(`Profile update failed: ${friendlyAuthError(error)}`, true); }
    return;
  }
  if (event.target.id !== "rule-form") return;
  const form = new FormData(event.target);
  const name = String(form.get("name") || "").trim();
  if (!name) return;
  state.habits.push({ id: crypto.randomUUID(), name, detail: String(form.get("detail") || "").trim() });
  cacheAndSync();
  render();
});
content.addEventListener("input", event => {
  if (event.target.id !== "journal-entry") return;
  if (!isPastOrToday(selectedDate)) return;
  state.journal[selectedDate] = event.target.value;
  const status = document.querySelector("#journal-status");
  if (status) status.textContent = "Saving...";
  cacheAndSync();
  window.clearTimeout(event.target.saveLabelTimer);
  event.target.saveLabelTimer = window.setTimeout(() => {
    const currentStatus = document.querySelector("#journal-status");
    if (currentStatus) currentStatus.textContent = "Saved privately to your account.";
  }, 500);
});

if (!firebaseReady()) {
  setupNote.textContent = "Setup required: add your Firebase web app values to firebase-config.js, enable Email/Password sign-in, then publish firestore.rules. See README.md.";
} else {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  setupNote.textContent = "Each account has its own private tracker. Data syncs across your signed-in devices.";
  try { await setPersistence(auth, browserLocalPersistence); }
  catch { setupNote.textContent = "Your browser may not keep you signed in. Check its privacy or storage settings."; }
  onAuthStateChanged(auth, currentUser => {
    user = currentUser;
    if (!user) {
      if (unsubscribeState) unsubscribeState();
      unsubscribeState = null;
      window.clearTimeout(saveTimer);
      state = initialState();
      authMode = "signin";
      updateAuthMode();
      appView.hidden = true;
      authView.hidden = false;
      return;
    }
    authView.hidden = true;
    appView.hidden = false;
    document.querySelector("#account-email").textContent = user.displayName || user.email || "Signed in";
    document.querySelector("#account-email").title = user.email || "";
    selectedDate = clampDate(todayKey());
    startUserData(user);
    updateCountdown();
  });
  window.setInterval(updateCountdown, 60_000);
}
