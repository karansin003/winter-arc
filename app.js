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
const ARC_END = "2026-12-31";
const ARC_DAYS = 92;
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
const profileDialog = document.querySelector("#profile-dialog");
const profileTrigger = document.querySelector("#profile-trigger");
const profileCloseBtn = document.querySelector("#profile-close-btn");
const profileModalForm = document.querySelector("#profile-modal-form");
const passwordInput = document.querySelector("#password");
const togglePasswordBtn = document.querySelector("#toggle-password");

let auth;
let db;
let user = null;
let userProfile = null;
let unsubscribeState = null;
let unsubscribeProfile = null;
let saveTimer;
let authMode = "signin";
let activeTab = "today";
let selectedDate = clampDate(todayKey());
let state = initialState();

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayKey() {
  return dateKey(new Date());
}

function parseDate(key) {
  return new Date(`${key}T00:00:00`);
}

function addDays(key, amount) {
  const date = parseDate(key);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function clampDate(key) {
  return key < ARC_START ? ARC_START : key > ARC_END ? ARC_END : key;
}

function initialState() {
  return { habits: structuredClone(CORE_HABITS), logs: {}, journal: {} };
}

function normalizeState(value) {
  if (!value || typeof value !== "object") return initialState();
  const defaults = initialState();
  const habits = Array.isArray(value.habits)
    ? value.habits.filter(h => h && typeof h.id === "string" && typeof h.name === "string")
    : defaults.habits;
  return {
    habits,
    logs: value.logs && typeof value.logs === "object" ? value.logs : {},
    journal: value.journal && typeof value.journal === "object" ? value.journal : {}
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function completedCount(day) {
  const log = state.logs[day] || {};
  return state.habits.filter(habit => log[habit.id] === true).length;
}

function isPerfect(day) {
  return state.habits.length > 0 && completedCount(day) === state.habits.length;
}

function isPastOrToday(day) {
  const today = todayKey();
  // If user opens the app before the arc starts (e.g. Sep 30), allow Day 1 (Oct 01) to be interactive
  if (today < ARC_START) {
    return day === ARC_START;
  }
  return day <= today && day >= ARC_START;
}

function dayPercent(day) {
  return state.habits.length ? Math.round((completedCount(day) / state.habits.length) * 100) : 0;
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

function localCacheKey() {
  return user ? `winter-arc:${user.uid}` : "";
}

function showMessage(message, error = false) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  if (error) toast.style.borderColor = "var(--orange)";
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function getSelectedLabel() {
  return parseDate(selectedDate).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function updateCountdown() {
  const target = new Date(2027, 0, 1, 0, 0, 0, 0).getTime();
  const start = parseDate(ARC_START).getTime();
  const now = Date.now();
  const remaining = Math.max(0, target - now);
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const arcTotal = target - start;
  const percent = Math.max(0, Math.min(100, ((now - start) / arcTotal) * 100));

  const daysEl = document.querySelector("#count-days");
  const hoursEl = document.querySelector("#count-hours");
  const minEl = document.querySelector("#count-minutes");
  const pctEl = document.querySelector("#global-percent");
  const barEl = document.querySelector("#global-bar");
  const labelEl = document.querySelector("#countdown-label");

  if (daysEl) daysEl.textContent = String(days).padStart(2, "0");
  if (hoursEl) hoursEl.textContent = String(hours).padStart(2, "0");
  if (minEl) minEl.textContent = String(minutes).padStart(2, "0");
  if (pctEl) pctEl.textContent = `${Math.floor(percent)}%`;
  if (barEl) barEl.style.width = `${percent}%`;

  if (labelEl) {
    if (now < start) {
      labelEl.textContent = "ARC LAUNCHES OCT 01 (TOMORROW)";
    } else if (remaining > 0) {
      labelEl.textContent = "COUNTDOWN TO JAN 01";
    } else {
      labelEl.textContent = "THE ARC IS COMPLETE";
    }
  }
}

function updateProfileUI() {
  const name = userProfile?.displayName || user?.displayName || user?.email || "Warrior";
  const initial = (name.trim()[0] || "W").toUpperCase();
  const email = user?.email || "—";
  const streak = currentStreak();
  const perfectDays = Object.keys(state.logs).filter(day => isPerfect(day)).length;
  const pctText = document.querySelector("#global-percent")?.textContent || "0%";

  // Topbar chip
  const topAvatar = document.querySelector("#top-avatar");
  if (topAvatar) topAvatar.textContent = initial;
  const accountEmail = document.querySelector("#account-email");
  if (accountEmail) {
    accountEmail.textContent = name;
    accountEmail.title = email;
  }

  // Modal dialog elements
  const avatarLarge = document.querySelector("#profile-avatar-large");
  if (avatarLarge) avatarLarge.textContent = initial;
  const headerName = document.querySelector("#profile-header-name");
  if (headerName) headerName.textContent = name;
  const headerEmail = document.querySelector("#profile-header-email");
  if (headerEmail) headerEmail.textContent = email;

  const statStreak = document.querySelector("#profile-stat-streak");
  if (statStreak) statStreak.textContent = `${streak} 🔥`;
  const statPerfect = document.querySelector("#profile-stat-perfect");
  if (statPerfect) statPerfect.textContent = String(perfectDays);
  const statPct = document.querySelector("#profile-stat-pct");
  if (statPct) statPct.textContent = pctText;

  const pName = document.querySelector("#p-name");
  if (pName && document.activeElement !== pName) pName.value = userProfile?.displayName || user?.displayName || "";
  const pGoal = document.querySelector("#p-goal");
  if (pGoal && document.activeElement !== pGoal) pGoal.value = userProfile?.primaryGoal || "";
  const pWake = document.querySelector("#p-wake");
  if (pWake) pWake.value = userProfile?.wakeUpTime || "05:00 AM";
  const pFocus = document.querySelector("#p-focus");
  if (pFocus && document.activeElement !== pFocus) pFocus.value = userProfile?.dailyTarget || "";
  const pMantra = document.querySelector("#p-mantra");
  if (pMantra && document.activeElement !== pMantra) pMantra.value = userProfile?.mantra || "";

  const emailMeta = document.querySelector("#profile-email-meta");
  if (emailMeta) emailMeta.textContent = email;
  const sinceMeta = document.querySelector("#profile-since-meta");
  const createdAt = user?.metadata?.creationTime;
  if (sinceMeta) {
    sinceMeta.textContent = createdAt
      ? new Date(createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "—";
  }
}

function renderToday() {
  const date = selectedDate;
  const percent = dayPercent(date);
  const count = completedCount(date);
  const circumference = 2 * Math.PI * 35;
  const offset = circumference * (1 - percent / 100);
  const canEdit = isPastOrToday(date);
  const isActualToday = date === clampDate(todayKey());
  const dayNum = Math.max(1, Math.min(ARC_DAYS, Math.round((parseDate(date).getTime() - parseDate(ARC_START).getTime()) / DAY_MS) + 1));
  const habits = state.habits.length
    ? state.habits
        .map(habit => {
          const checked = (state.logs[date] || {})[habit.id] === true;
          return `<label class="habit-row ${checked ? "done habit-done" : ""}">
            <input class="habit-check" type="checkbox" data-habit-check="${escapeHtml(habit.id)}" ${checked ? "checked" : ""} ${canEdit ? "" : "disabled"}>
            <span class="habit-copy">
              <span class="habit-name">${escapeHtml(habit.name)}</span>
              <span class="habit-detail">${escapeHtml(habit.detail || "")}</span>
            </span>
          </label>`;
        })
        .join("")
    : `<div class="empty">No rules yet. Add your first one in My rules.</div>`;

  const quoteSeed = [...date].reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 7);
  const quoteIndex = quoteSeed % QUOTES.length;

  return `<div class="content-heading">
      <div>
        <p class="eyebrow">DAY ${dayNum} OF ${ARC_DAYS} · ${isActualToday ? "TODAY" : "DAY " + dayNum}</p>
        <h2>${isActualToday ? "Today's rules & execution" : `Day ${dayNum} rules & execution`}</h2>
      </div>
      <div class="today-heading-actions">
        <span class="date-label">${escapeHtml(getSelectedLabel())}</span>
        ${!isActualToday ? `<button type="button" class="small-button accent-back-btn" data-action="return-today" title="Return to current day">Back to Today</button>` : ""}
      </div>
    </div>
    <div class="today-grid">
      <section class="panel panel-pad">
        <p class="panel-kicker">NON-NEGOTIABLES · ${count}/${state.habits.length}</p>
        <h3 class="panel-title">Keep the promises you made.</h3>
        <div class="habit-list">${habits}</div>
      </section>
      <div class="side-stack">
        <section class="panel panel-pad progress-panel">
          <svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${percent}% complete">
            <circle class="track" cx="42" cy="42" r="35"></circle>
            <circle class="value" cx="42" cy="42" r="35" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 42 42)"></circle>
            <text x="42" y="47" text-anchor="middle">${percent}%</text>
          </svg>
          <div class="progress-copy">
            <strong>${percent === 100 ? "A perfect day." : `${count} of ${state.habits.length} complete`}</strong>
            <span>${canEdit ? "One checked promise at a time." : "Future day · checklist is locked."}</span>
          </div>
        </section>
        <section class="panel panel-pad quote-panel">
          <div>
            <p class="panel-kicker">TODAY'S REMINDER</p>
            <p class="quote">“${escapeHtml(QUOTES[quoteIndex])}”</p>
          </div>
        </section>
      </div>
    </div>
    <section class="panel streak-panel">
      <div>
        <span class="panel-kicker">CURRENT STREAK</span>
        <strong>${currentStreak()} <span class="streak-flame">🔥</span></strong>
      </div>
      <span>Consecutive perfect days</span>
    </section>`;
}

function renderCalendar() {
  const days = Array.from({ length: ARC_DAYS }, (_, index) => addDays(ARC_START, index));
  const activeDayKey = clampDate(todayKey());
  const cells = days
    .map((day, index) => {
      const done = completedCount(day);
      const future = day > todayKey();
      const status = isPerfect(day) ? "complete" : done ? "partial" : "";
      const isCurrentDay = day === activeDayKey;
      const label = `Day ${index + 1}, ${day}, ${isPerfect(day) ? "complete" : done ? `${dayPercent(day)} percent complete` : future ? "future" : "not started"}`;
      return `<button type="button" class="calendar-day ${status} ${future ? "future" : ""} ${selectedDate === day ? "selected" : ""} ${isCurrentDay ? "today-cell" : ""}" data-select-day="${day}" aria-label="${label}" title="Click to open rules for Day ${index + 1} (${day})">${index + 1}</button>`;
    })
    .join("");

  return `<div class="content-heading">
      <div>
        <p class="eyebrow">OCT 01 — DEC 31 · 92 DAYS</p>
        <h2>92-Day Execution Grid</h2>
      </div>
      <span class="date-label">Click any day to open its rules & checklist</span>
    </div>
    <section class="panel panel-pad">
      <div class="calendar-grid">${cells}</div>
      <div class="calendar-legend">
        <span class="legend-item"><i class="legend-swatch complete"></i>All done</span>
        <span class="legend-item"><i class="legend-swatch partial"></i>Partially done</span>
        <span class="legend-item"><i class="legend-swatch"></i>Not done / future</span>
        <span class="legend-item"><i class="legend-swatch" style="border: 1px solid var(--lime); box-shadow: 0 0 6px var(--lime);"></i>Current active day</span>
      </div>
    </section>
    <section class="panel panel-pad selected-day">
      <div class="content-heading">
        <div>
          <p class="panel-kicker">SELECTED DAY</p>
          <h2>${escapeHtml(getSelectedLabel())}</h2>
        </div>
        <button class="small-button button-primary" type="button" data-action="open-today">Open Rules & Checklist →</button>
      </div>
      <p class="muted">${completedCount(selectedDate)} of ${state.habits.length} rules completed · ${dayPercent(selectedDate)}%</p>
    </section>`;
}

function renderHabits() {
  const items = state.habits
    .map(
      habit => `<div class="rule-item">
        <div>
          <strong>${escapeHtml(habit.name)}</strong>
          <p>${escapeHtml(habit.detail || "")}</p>
        </div>
        <div class="rule-actions">
          <button type="button" class="small-button" data-action="edit-habit" data-id="${escapeHtml(habit.id)}">Edit</button>
          <button type="button" class="small-button danger" data-action="delete-habit" data-id="${escapeHtml(habit.id)}">Delete</button>
        </div>
      </div>`
    )
    .join("");

  return `<div class="content-heading">
      <div>
        <p class="eyebrow">MAKE IT YOURS</p>
        <h2>Your non-negotiables</h2>
      </div>
    </div>
    <section class="panel panel-pad">
      <p class="muted">A rule is complete when you have kept the whole promise for that pillar.</p>
      <form id="rule-form" class="rule-form">
        <input name="name" maxlength="48" placeholder="Rule name" aria-label="Rule name" required>
        <input name="detail" maxlength="140" placeholder="What does done look like?" aria-label="Rule details">
        <button class="button button-primary" type="submit">Add rule +</button>
      </form>
      <div>${items || `<div class="empty">No rules. Add one above to get started.</div>`}</div>
    </section>`;
}

function renderJournal() {
  const entry = state.journal[selectedDate] || "";
  return `<div class="content-heading">
      <div>
        <p class="eyebrow">ONE LINE, NO FILTER</p>
        <h2>Daily reflection</h2>
      </div>
      <span class="date-label">${escapeHtml(getSelectedLabel())}</span>
    </div>
    <section class="panel panel-pad">
      <label class="panel-kicker" for="journal-entry">WHAT WAS YOUR WIN TODAY?</label>
      <textarea id="journal-entry" class="journal-input" maxlength="280" placeholder="One win. One lesson. One honest sentence." ${isPastOrToday(selectedDate) ? "" : "disabled"}>${escapeHtml(entry)}</textarea>
      <div id="journal-status" class="journal-status">${isPastOrToday(selectedDate) ? "Saved privately to your account." : "Future day · journal is locked."}</div>
    </section>
    <p class="muted">Your journal is private to your signed-in account and synced to your Firebase profile.</p>`;
}

function render() {
  if (!["today", "calendar", "habits", "journal"].includes(activeTab)) {
    activeTab = "today";
  }
  document.querySelectorAll(".tab").forEach(tab => {
    const active = tab.dataset.tab === activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  content.innerHTML = {
    today: renderToday,
    calendar: renderCalendar,
    habits: renderHabits,
    journal: renderJournal
  }[activeTab]();
}

function cacheAndSync() {
  if (!user) return;
  try {
    localStorage.setItem(localCacheKey(), JSON.stringify(state));
  } catch {
    showMessage("Browser storage is unavailable.", true);
  }

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await setDoc(doc(db, "users", user.uid, "winterArc", "state"), {
        state,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      showMessage(`Cloud save failed: ${error.message}`, true);
    }
  }, 350);
}

function startUserData(currentUser) {
  if (unsubscribeState) unsubscribeState();
  if (unsubscribeProfile) unsubscribeProfile();

  const cacheKey = `winter-arc:${currentUser.uid}`;
  const profileCacheKey = `winter-arc-profile:${currentUser.uid}`;

  // 1. Sync habits, logs, and journal
  const stateRef = doc(db, "users", currentUser.uid, "winterArc", "state");
  let firstSnapshot = true;
  unsubscribeState = onSnapshot(
    stateRef,
    snapshot => {
      if (snapshot.exists() && snapshot.data().state) {
        state = normalizeState(snapshot.data().state);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(state));
        } catch {}
      } else if (firstSnapshot) {
        try {
          const cached = localStorage.getItem(cacheKey);
          state = cached ? normalizeState(JSON.parse(cached)) : initialState();
        } catch {
          state = initialState();
        }
        cacheAndSync();
      }
      firstSnapshot = false;
      render();
      updateProfileUI();
    },
    error => showMessage(`Could not load your data: ${error.message}`, true)
  );

  // 2. Sync profile details
  const profileRef = doc(db, "users", currentUser.uid, "winterArc", "profile");
  unsubscribeProfile = onSnapshot(
    profileRef,
    snapshot => {
      if (snapshot.exists()) {
        userProfile = snapshot.data();
        try {
          localStorage.setItem(profileCacheKey, JSON.stringify(userProfile));
        } catch {}
      } else {
        try {
          const cached = localStorage.getItem(profileCacheKey);
          if (cached) userProfile = JSON.parse(cached);
        } catch {}
        if (!userProfile) {
          userProfile = {
            displayName: currentUser.displayName || "",
            primaryGoal: "Build discipline and transform physically & mentally",
            wakeUpTime: "05:00 AM",
            dailyTarget: "45 min training + 2h deep focus",
            mantra: "Discipline is keeping a promise to yourself."
          };
        }
      }
      updateProfileUI();
      if (activeTab === "profile") render();
    },
    err => {
      console.warn("Could not load cloud profile:", err);
      try {
        const cached = localStorage.getItem(profileCacheKey);
        if (cached) userProfile = JSON.parse(cached);
      } catch {}
      updateProfileUI();
    }
  );
}

function updateAuthMode() {
  const create = authMode === "create";
  const extraFields = document.querySelector("#signup-extra-fields");
  const displayNameInput = document.querySelector("#display-name");
  const emailLabel = document.querySelector("#email-label");
  const emailInput = document.querySelector("#email");

  document.querySelector("#auth-title").textContent = create ? "Create your account" : "Login";
  document.querySelector("#auth-description").textContent = create
    ? "Set up your private tracker. All your habits and daily logs sync across devices."
    : "Pick up exactly where you left off.";
  document.querySelector("#auth-submit").innerHTML = `${create ? "Start Winter Arc" : "Login"} <span aria-hidden="true">↗</span>`;
  document.querySelector("#auth-switch").textContent = create ? "Already have an account? Login" : "Create an account";
  document.querySelector("#password").autocomplete = create ? "new-password" : "current-password";

  if (extraFields) extraFields.hidden = !create;
  if (displayNameInput) displayNameInput.required = create;

  if (emailLabel && emailInput) {
    emailLabel.innerHTML = 'Email *';
    emailInput.required = true;
    emailInput.type = "email";
    emailInput.placeholder = "you@example.com";
  }

  authMessage.textContent = "";
}

function firebaseReady() {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("YOUR_") &&
    firebaseConfig.authDomain &&
    !firebaseConfig.authDomain.startsWith("YOUR_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("YOUR_") &&
    firebaseConfig.appId &&
    !firebaseConfig.appId.startsWith("YOUR_")
  );
}

function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email. Sign in instead.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Try again in a little while.",
    "auth/network-request-failed": "Network error. Check your internet connection."
  };
  return messages[error.code] || error.message;
}

async function handleProfileSave(formData) {
  const name = String(formData.get("name") || "").trim();
  const primaryGoal = String(formData.get("primaryGoal") || "").trim();
  const wakeUpTime = String(formData.get("wakeUpTime") || "05:00 AM");
  const dailyTarget = String(formData.get("dailyTarget") || "").trim();
  const mantra = String(formData.get("mantra") || "").trim();

  if (!name || !auth.currentUser) return;
  const saveBtn = document.querySelector("#save-profile-btn");
  if (saveBtn) {
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;
  }

  // 1. Immediately update local state and localStorage
  userProfile = {
    displayName: name,
    primaryGoal,
    wakeUpTime,
    dailyTarget,
    mantra,
    email: auth.currentUser.email || "",
    updatedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(`winter-arc-profile:${auth.currentUser.uid}`, JSON.stringify(userProfile));
  } catch {}

  // 2. Immediately reflect changes in header, avatar and dialog
  updateProfileUI();

  // 3. Save to Firebase Auth & Firestore with non-blocking timeout
  try {
    const authUpdate = updateProfile(auth.currentUser, { displayName: name });
    const firestoreUpdate = setDoc(
      doc(db, "users", auth.currentUser.uid, "winterArc", "profile"),
      {
        ...userProfile,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await Promise.race([
      Promise.all([authUpdate, firestoreUpdate]),
      new Promise(resolve => setTimeout(resolve, 800))
    ]);

    user = auth.currentUser;
    showMessage("Profile saved successfully!");
  } catch (error) {
    console.warn("Cloud save warning:", error);
    showMessage("Profile saved.");
  } finally {
    if (saveBtn) {
      saveBtn.textContent = "Save Profile Changes";
      saveBtn.disabled = false;
    }
  }
}

// Password toggle visibility
if (togglePasswordBtn && passwordInput) {
  togglePasswordBtn.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    togglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    togglePasswordBtn.title = isPassword ? "Hide password" : "Show password";
    const slash = togglePasswordBtn.querySelector(".eye-slash");
    if (slash) slash.style.display = isPassword ? "block" : "none";
  });
}

// Profile dialog trigger in top-right
if (profileTrigger && profileDialog) {
  profileTrigger.addEventListener("click", () => {
    updateProfileUI();
    profileDialog.showModal();
  });
}

if (profileCloseBtn && profileDialog) {
  profileCloseBtn.addEventListener("click", () => {
    profileDialog.close();
  });
}

if (profileDialog) {
  profileDialog.addEventListener("click", event => {
    const card = profileDialog.querySelector(".dialog-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isInDialog) profileDialog.close();
  });
}

// Modal profile form submission
if (profileModalForm) {
  profileModalForm.addEventListener("submit", async event => {
    event.preventDefault();
    await handleProfileSave(new FormData(profileModalForm));
  });
}

// Modal action buttons

const modalSignOut = document.querySelector("#modal-sign-out");
if (modalSignOut) {
  modalSignOut.addEventListener("click", async () => {
    if (profileDialog && profileDialog.open) profileDialog.close();
    try {
      await signOut(auth);
    } catch (error) {
      showMessage(`Sign out failed: ${friendlyAuthError(error)}`, true);
    }
  });
}

// Auth submission (Sign in / Create Account)
authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!auth) return;
  const email = (authForm.email?.value || "").trim();
  const password = authForm.password.value;
  const displayName = (document.querySelector("#display-name")?.value || "").trim();
  const primaryGoal = (document.querySelector("#signup-goal")?.value || "").trim();
  const wakeUpTime = document.querySelector("#signup-wake")?.value || "05:00 AM";
  const dailyTarget = (document.querySelector("#signup-focus")?.value || "").trim();
  const mantra = (document.querySelector("#signup-mantra")?.value || "").trim();

  if (!email) {
    authMessage.textContent = "Please enter your email.";
    return;
  }
  if (authMode === "create" && !displayName) {
    authMessage.textContent = "Please enter your name or ghost alias.";
    return;
  }

  authMessage.textContent = "Working...";
  try {
    if (authMode === "create") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: displayName || "Ghost Warrior" });

      const newProfile = {
        displayName: displayName || "Ghost Warrior",
        primaryGoal: primaryGoal || "Physical & mental transformation",
        wakeUpTime,
        dailyTarget: dailyTarget || "45 min training + 2h deep focus",
        mantra: mantra || "Discipline is keeping a promise to yourself.",
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      try {
        await setDoc(doc(db, "users", credential.user.uid, "winterArc", "profile"), newProfile);
        localStorage.setItem(`winter-arc-profile:${credential.user.uid}`, JSON.stringify(newProfile));
      } catch (err) {
        console.warn("Could not save initial profile doc:", err);
      }
      userProfile = newProfile;
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    authForm.reset();
  } catch (error) {
    authMessage.textContent = friendlyAuthError(error);
  }
});

document.querySelector("#auth-switch").addEventListener("click", () => {
  authMode = authMode === "signin" ? "create" : "signin";
  updateAuthMode();
});

const resetPasswordLink = document.querySelector("#reset-password");
if (resetPasswordLink) {
  resetPasswordLink.addEventListener("click", (e) => {
    const email = (authForm.email?.value || "").trim();
    if (email) {
      e.preventDefault();
      window.location.href = `forgot.html?email=${encodeURIComponent(email)}`;
    }
    // If empty, normal <a href="forgot.html"> navigation takes over seamlessly
  });
}

document.querySelector("#sign-out").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showMessage(`Sign out failed: ${friendlyAuthError(error)}`, true);
  }
});

document.querySelectorAll(".tab").forEach(tab =>
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    if (activeTab === "today") {
      selectedDate = clampDate(todayKey());
    }
    render();
  })
);

// Habit checklist interaction
content.addEventListener("change", event => {
  const checkbox = event.target.closest("[data-habit-check]");
  if (!checkbox || !isPastOrToday(selectedDate)) return;
  state.logs[selectedDate] ||= {};
  state.logs[selectedDate][checkbox.dataset.habitCheck] = checkbox.checked;
  cacheAndSync();
  render();
  updateProfileUI();
});

// Main content delegated click actions
content.addEventListener("click", async event => {
  const dayButton = event.target.closest("[data-select-day]");
  if (dayButton) {
    selectedDate = dayButton.dataset.selectDay;
    activeTab = "today";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  if (action.dataset.action === "open-today") {
    activeTab = "today";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (action.dataset.action === "return-today") {
    selectedDate = clampDate(todayKey());
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
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

// Rule form submissions
content.addEventListener("submit", async event => {
  event.preventDefault();
  if (event.target.id !== "rule-form") return;
  const form = new FormData(event.target);
  const name = String(form.get("name") || "").trim();
  if (!name) return;
  state.habits.push({ id: crypto.randomUUID(), name, detail: String(form.get("detail") || "").trim() });
  cacheAndSync();
  render();
});

// Journal auto-save
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

// Firebase init & auth state observer
if (!firebaseReady()) {
  setupNote.textContent =
    "Setup required: add your Firebase web app values to firebase-config.js, enable Email/Password sign-in, then publish firestore.rules. See README.md.";
} else {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  setupNote.textContent = "Each account has its own private tracker. Data syncs across your signed-in devices.";

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    setupNote.textContent = "Your browser may not keep you signed in. Check its privacy or storage settings.";
  }

  onAuthStateChanged(auth, currentUser => {
    user = currentUser;
    if (!user) {
      if (unsubscribeState) unsubscribeState();
      if (unsubscribeProfile) unsubscribeProfile();
      unsubscribeState = null;
      unsubscribeProfile = null;
      window.clearTimeout(saveTimer);
      state = initialState();
      userProfile = null;
      authMode = "signin";
      updateAuthMode();
      appView.hidden = true;
      authView.hidden = false;
      return;
    }

    authView.hidden = true;
    appView.hidden = false;
    selectedDate = clampDate(todayKey());
    startUserData(user);
    updateCountdown();
    updateProfileUI();
  });

  window.setInterval(updateCountdown, 60_000);
}
