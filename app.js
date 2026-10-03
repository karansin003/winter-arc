import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  applyActionCode,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
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
const globalSiteHeader = document.querySelector("#global-site-header");
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

const verificationPanel = document.querySelector("#verification-panel");
const verifyUserEmail = document.querySelector("#verify-user-email");
const verifyFeedback = document.querySelector("#verify-feedback");
const btnCheckVerified = document.querySelector("#btn-check-verified");
const btnResendVerification = document.querySelector("#btn-resend-verification");
const btnBackToLogin = document.querySelector("#btn-back-to-login");

let verifyCooldownTimer = null;

function showVerificationScreen(email, keepFeedback = false) {
  if (authForm) authForm.hidden = true;
  if (verificationPanel) verificationPanel.hidden = false;
  if (verifyUserEmail) verifyUserEmail.textContent = email || auth?.currentUser?.email || "your email";
  if (!keepFeedback && verifyFeedback) verifyFeedback.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function hideVerificationScreen() {
  if (verificationPanel) verificationPanel.hidden = true;
  if (authForm) authForm.hidden = false;
  if (verifyFeedback) verifyFeedback.hidden = true;
  if (verifyCooldownTimer) {
    clearInterval(verifyCooldownTimer);
    verifyCooldownTimer = null;
  }
}

function showVerifyFeedback(type, message) {
  if (!verifyFeedback) return;
  verifyFeedback.hidden = false;
  verifyFeedback.className = `recovery-box recovery-${type}`;
  const icon = type === "success"
    ? `<span style="color:var(--lime);font-size:18px;">✓</span>`
    : type === "warning"
    ? `<span style="color:#fbbf24;font-size:18px;">⚠️</span>`
    : `<span style="color:var(--orange);font-size:18px;">✕</span>`;

  verifyFeedback.innerHTML = `
    <div class="recovery-icon">${icon}</div>
    <div class="recovery-body">
      <p style="margin:0;font-size:13px;line-height:1.5;">${escapeHtml(message)}</p>
    </div>
  `;
}

const SESSION_FLAG = "winter_arc_active_session";

let auth;
let db;
let user = null;
let userProfile = null;
let unsubscribeState = null;
let unsubscribeProfile = null;
let unsubscribeNotifications = null;
let knownNotificationIds = new Set();
let hasInitializedNotifications = false;
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

function currentActiveDay() {
  const today = todayKey();
  if (today < ARC_START) {
    return ARC_START;
  }
  if (today > ARC_END) {
    return ARC_END;
  }
  return today;
}

function isDayEditable(day) {
  // Strict Mode: Only the active running day can be modified before 12:00 AM midnight
  return day === currentActiveDay();
}

function isDayPast(day) {
  return day < currentActiveDay();
}

function isDayFuture(day) {
  return day > currentActiveDay();
}

function getMidnightRemainingText() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const diffMs = Math.max(0, midnight.getTime() - now.getTime());
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
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

function initSessionRestore() {
  const cachedUid = localStorage.getItem(SESSION_FLAG);
  const isExplicitSignout = localStorage.getItem("winter_arc_explicit_signout") === "true";
  if (cachedUid && !isExplicitSignout) {
    document.documentElement.classList.add("has-active-session");
    document.body.classList.add("user-authenticated");
    if (globalSiteHeader) globalSiteHeader.hidden = true;
    if (authView) authView.hidden = true;
    if (appView) appView.hidden = false;
    try {
      const cachedData = localStorage.getItem(`winter-arc:${cachedUid}`);
      if (cachedData) {
        state = normalizeState(JSON.parse(cachedData));
      }
      const cachedProfile = localStorage.getItem(`winter-arc-profile:${cachedUid}`);
      if (cachedProfile) {
        userProfile = JSON.parse(cachedProfile);
      }
    } catch (e) {}
    selectedDate = currentActiveDay();
    render();
    updateProfileUI();
  }
}
initSessionRestore();

function renderToday() {
  const date = selectedDate;
  const percent = dayPercent(date);
  const count = completedCount(date);
  const circumference = 2 * Math.PI * 35;
  const offset = circumference * (1 - percent / 100);
  const canEdit = isDayEditable(date);
  const isPast = isDayPast(date);
  const isFuture = isDayFuture(date);
  const isActualToday = date === currentActiveDay();
  const dayNum = Math.max(1, Math.min(ARC_DAYS, Math.round((parseDate(date).getTime() - parseDate(ARC_START).getTime()) / DAY_MS) + 1));
  const habits = state.habits.length
    ? state.habits
        .map(habit => {
          const checked = (state.logs[date] || {})[habit.id] === true;
          return `<label class="habit-row ${checked ? "done habit-done" : ""} ${canEdit ? "" : "locked-row"}">
            <input class="habit-check" type="checkbox" data-habit-check="${escapeHtml(habit.id)}" ${checked ? "checked" : ""} ${canEdit ? "" : "disabled"}>
            <span class="habit-copy">
              <span class="habit-name">${escapeHtml(habit.name)}</span>
              <span class="habit-detail">${escapeHtml(habit.detail || "")}</span>
            </span>
            ${!canEdit ? `<span style="font-size: 11px; color: var(--muted); margin-left: auto;">🔒 Locked</span>` : ""}
          </label>`;
        })
        .join("")
    : `<div class="empty">No rules yet. Add your first one in My rules.</div>`;

  const quoteSeed = [...date].reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 7);
  const quoteIndex = quoteSeed % QUOTES.length;

  return `<div class="content-heading">
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
          <p class="eyebrow" style="margin: 0;">DAY ${dayNum} OF ${ARC_DAYS} · ${isActualToday ? "TODAY" : isPast ? "PAST DAY" : "UPCOMING"}</p>
          <span class="strict-pill ${canEdit ? "" : isPast ? "locked" : "future"}">${canEdit ? "🔒 STRICT MODE" : isPast ? "🔒 LOCKED AT 12:00 AM" : "🔒 UPCOMING"}</span>
          ${canEdit ? `<span class="midnight-timer" id="today-midnight-timer">⏳ Locks in ${getMidnightRemainingText()}</span>` : ""}
        </div>
        <h2>${isActualToday ? "Today's rules & execution" : `Day ${dayNum} rules & execution`}</h2>
      </div>
      <div class="today-heading-actions">
        ${canEdit ? `
        <button type="button" class="save-today-btn" id="save-today-btn" data-action="save-today" title="Save today's progress to cloud">
          <span>💾</span> <span id="save-btn-label">Save Progress</span>
        </button>
        ` : `
        <button type="button" class="small-button accent-back-btn" data-action="return-today" title="Return to current active day">⚡ Return to Today</button>
        `}
        <span class="date-label">${escapeHtml(getSelectedLabel())}</span>
      </div>
    </div>
    ${isPast ? `
    <div class="locked-banner past">
      <div>
        <strong>🔒 Past Day Locked in Strict Mode:</strong>
        <span>Midnight (12:00 AM) has passed. Past checklist entries cannot be modified to ensure authentic discipline.</span>
      </div>
      <button type="button" class="small-button" data-action="return-today">Go to Today's Rules →</button>
    </div>` : isFuture ? `
    <div class="locked-banner future">
      <div>
        <strong>🔒 Upcoming Day Locked:</strong>
        <span>This checklist will unlock automatically on ${escapeHtml(getSelectedLabel())} at 12:00 AM midnight.</span>
      </div>
      <button type="button" class="small-button" data-action="return-today">Go to Today's Rules →</button>
    </div>` : ""}
    <div class="today-grid">
      <section class="panel panel-pad">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <p class="panel-kicker" style="margin: 0;">NON-NEGOTIABLES · ${count}/${state.habits.length}</p>
          ${canEdit ? `<span id="auto-save-tag" style="font: 10px var(--mono); color: var(--lime);">⚡ Auto-saved to Cloud</span>` : ""}
        </div>
        <h3 class="panel-title">${canEdit ? "Keep the promises you made." : "Execution record finalized."}</h3>
        <div class="habit-list">${habits}</div>
        ${canEdit ? `
        <div class="strict-lock-note">
          <span>⏳ <strong>Auto-Locks at 12:00 AM:</strong> Cannot modify after midnight.</span>
          <span style="color: var(--lime); cursor: pointer;" data-action="save-today">Save now →</span>
        </div>` : ""}
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
            <span>${canEdit ? "One checked promise at a time." : isPast ? "Locked at 12:00 AM · Record finalized." : "Future day · checklist is locked."}</span>
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
  const activeDayKey = currentActiveDay();
  const cells = days
    .map((day, index) => {
      const done = completedCount(day);
      const isPast = day < activeDayKey;
      const isFuture = day > activeDayKey;
      const isCurrentDay = day === activeDayKey;
      const status = isPerfect(day) ? "complete" : done ? "partial" : "";
      const label = `Day ${index + 1}, ${day}, ${isPerfect(day) ? "complete" : done ? `${dayPercent(day)} percent complete` : isPast ? "locked" : isFuture ? "future" : "active today"}`;
      return `<button type="button" class="calendar-day ${status} ${isFuture ? "future" : ""} ${isPast ? "past-day" : ""} ${selectedDate === day ? "selected" : ""} ${isCurrentDay ? "today-cell" : ""}" data-select-day="${day}" aria-label="${label}" title="Day ${index + 1} (${day})${isPast ? ' · Locked at 12 AM' : isCurrentDay ? ' · Active Today' : ' · Future'}">
        <span>${index + 1}</span>
        ${isPast ? '<span class="day-lock-mark" aria-hidden="true">🔒</span>' : ""}
      </button>`;
    })
    .join("");

  return `<div class="content-heading">
      <div>
        <p class="eyebrow">OCT 01 — DEC 31 · 92 DAYS</p>
        <h2>92-Day Execution Grid</h2>
      </div>
      <span class="date-label">Click any day to view rules · Past days locked at 12:00 AM</span>
    </div>
    <section class="panel panel-pad">
      <div class="calendar-grid">${cells}</div>
      <div class="calendar-legend">
        <span class="legend-item"><i class="legend-swatch complete"></i>All done</span>
        <span class="legend-item"><i class="legend-swatch partial"></i>Partially done</span>
        <span class="legend-item"><i class="legend-swatch"></i>Not done</span>
        <span class="legend-item"><i class="legend-swatch" style="border: 1px solid var(--lime); box-shadow: 0 0 6px var(--lime);"></i>Current active day</span>
        <span class="legend-item"><span style="font-size: 11px;">🔒</span> Past locked days</span>
      </div>
    </section>
    <section class="panel panel-pad selected-day">
      <div class="content-heading">
        <div>
          <p class="panel-kicker">SELECTED DAY ${selectedDate === activeDayKey ? "· ACTIVE TODAY" : selectedDate < activeDayKey ? "· LOCKED" : "· UPCOMING"}</p>
          <h2>${escapeHtml(getSelectedLabel())}</h2>
        </div>
        <button class="small-button button-primary" type="button" data-action="open-today">${selectedDate === activeDayKey ? "Open Today's Rules →" : "View Day Rules →"}</button>
      </div>
      <p class="muted">${completedCount(selectedDate)} of ${state.habits.length} rules completed · ${dayPercent(selectedDate)}% ${selectedDate < activeDayKey ? "· Finalized at 12:00 AM midnight" : selectedDate === activeDayKey ? "· Active until 12:00 AM midnight" : ""}</p>
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
  const canEdit = isDayEditable(selectedDate);
  const isPast = isDayPast(selectedDate);
  const isFuture = isDayFuture(selectedDate);
  const isActualToday = selectedDate === currentActiveDay();
  const dayNum = Math.max(1, Math.min(ARC_DAYS, Math.round((parseDate(selectedDate).getTime() - parseDate(ARC_START).getTime()) / DAY_MS) + 1));

  let statusMsg = "";
  if (canEdit) {
    statusMsg = `⚡ Editable today · Auto-saves & permanently locks at 12:00 AM midnight.`;
  } else if (isPast) {
    statusMsg = `🔒 Locked in Strict Mode · Finalized at 12:00 AM midnight. Cannot be modified.`;
  } else {
    statusMsg = `🔒 Upcoming day · Journal is locked until 12:00 AM midnight on this day.`;
  }

  return `<div class="content-heading">
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
          <p class="eyebrow" style="margin: 0;">DAY ${dayNum} · ${isActualToday ? "TODAY" : isPast ? "PAST (LOCKED)" : "UPCOMING"}</p>
          <span class="strict-pill ${canEdit ? "" : isPast ? "locked" : "future"}">${canEdit ? "🔒 STRICT MODE" : isPast ? "🔒 LOCKED AT 12:00 AM" : "🔒 UPCOMING"}</span>
          ${canEdit ? `<span class="midnight-timer" id="today-midnight-timer">⏳ Locks in ${getMidnightRemainingText()}</span>` : ""}
        </div>
        <h2>Daily reflection</h2>
      </div>
      <div class="today-heading-actions">
        ${canEdit ? `
        <button type="button" class="save-today-btn" id="save-today-btn" data-action="save-today" title="Save today's progress to cloud">
          <span>💾</span> <span id="save-btn-label">Save Progress</span>
        </button>
        ` : `
        <button type="button" class="small-button accent-back-btn" data-action="return-today" title="Return to current active day">⚡ Return to Today</button>
        `}
        <span class="date-label">${escapeHtml(getSelectedLabel())}</span>
      </div>
    </div>
    ${isPast ? `
    <div class="locked-banner past">
      <div>
        <strong>🔒 Past Day Journal Locked:</strong>
        <span>This reflection was finalized at 12:00 AM midnight in Strict Mode to preserve honesty and discipline.</span>
      </div>
      <button type="button" class="small-button" data-action="return-today">Go to Today's Rules →</button>
    </div>` : isFuture ? `
    <div class="locked-banner future">
      <div>
        <strong>🔒 Upcoming Day Journal:</strong>
        <span>This reflection will unlock automatically on ${escapeHtml(getSelectedLabel())} at 12:00 AM.</span>
      </div>
      <button type="button" class="small-button" data-action="return-today">Go to Today's Rules →</button>
    </div>` : ""}
    <section class="panel panel-pad">
      <label class="panel-kicker" for="journal-entry">WHAT WAS YOUR WIN TODAY?</label>
      <textarea id="journal-entry" class="journal-input" maxlength="280" placeholder="${canEdit ? "One win. One lesson. One honest sentence." : "No journal entry recorded for this day."}" ${canEdit ? "" : "disabled"}>${escapeHtml(entry)}</textarea>
      <div id="journal-status" class="journal-status">${statusMsg}</div>
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

async function saveImmediately() {
  if (!user) return false;
  try {
    localStorage.setItem(localCacheKey(), JSON.stringify(state));
  } catch {}

  window.clearTimeout(saveTimer);
  try {
    await setDoc(doc(db, "users", user.uid, "winterArc", "state"), {
      state,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error("Save error:", error);
    showMessage(`Save failed: ${error.message}`, true);
    return false;
  }
}

function cacheAndSync() {
  if (!user) return;
  try {
    localStorage.setItem(localCacheKey(), JSON.stringify(state));
  } catch {
    showMessage("Browser storage is unavailable.", true);
  }

  const autoTag = document.querySelector("#auto-save-tag");
  if (autoTag) autoTag.textContent = "⚡ Saving...";

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await setDoc(doc(db, "users", user.uid, "winterArc", "state"), {
        state,
        updatedAt: serverTimestamp()
      });
      updateDirectoryUser(user);
      const tag = document.querySelector("#auto-save-tag");
      if (tag) tag.textContent = "⚡ Auto-saved to Cloud";
    } catch (error) {
      showMessage(`Cloud save failed: ${error.message}`, true);
      const tag = document.querySelector("#auto-save-tag");
      if (tag) tag.textContent = "⚠️ Cloud save failed";
    }
  }, 350);
}

function startUserData(currentUser) {
  if (unsubscribeState) unsubscribeState();
  if (unsubscribeProfile) unsubscribeProfile();
  if (unsubscribeNotifications) unsubscribeNotifications();

  // 1. Sync Directory user record for Admin monitoring
  updateDirectoryUser(currentUser);

  // 2. Real-time Notifications from Admin
  startNotifications(currentUser);

  // 3. Admin Command Center button visibility
  const adminHeaderLink = document.querySelector("#admin-header-link");
  if (adminHeaderLink) {
    adminHeaderLink.hidden = !(currentUser.email && currentUser.email.toLowerCase() === "karansin8672@gmail.com");
  }

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
      updateDirectoryUser(currentUser);
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
        if (userProfile.isSuspended === true || userProfile.status === "suspended") {
          handleSignOut();
          showAuthAlert(
            "warning",
            "Account Suspended",
            "Your account has been suspended by the administrator. Tracker access has been revoked."
          );
          return;
        }
        if (userProfile.isDeleted === true || userProfile.status === "deleted") {
          handleSignOut();
          showAuthAlert(
            "error",
            "Account Deleted",
            "Your account has been permanently removed by the administrator."
          );
          return;
        }
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
      updateDirectoryUser(currentUser);
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
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "No warrior account found with this email. Please create an account.",
    "auth/user-disabled": "This account has been disabled. Please contact support.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many email requests. Firebase is rate-limiting; please wait 1-2 minutes.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/quota-exceeded": "Firebase daily email quota exceeded. Please try again tomorrow or contact admin."
  };
  return messages[error?.code] || error?.message || "An authentication error occurred.";
}

let resendInterval = null;

function showAuthAlert(type, title, messageHtml, options = {}) {
  const alertBox = document.querySelector("#auth-alert-box");
  if (!alertBox) return;

  if (resendInterval) {
    clearInterval(resendInterval);
    resendInterval = null;
  }

  alertBox.hidden = false;
  alertBox.className = `recovery-box recovery-${type}`;

  const iconSvg =
    type === "success"
      ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="success-glow"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
      : type === "warning"
      ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="warning-glow"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
      : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="error-glow"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

  let actionHtml = "";
  if (options.allowResend && options.email) {
    actionHtml = `
      <div>
        <button type="button" class="auth-alert-btn" id="resend-verification-btn">
          Resend Verification Email
        </button>
      </div>
    `;
  }

  alertBox.innerHTML = `
    <div class="recovery-icon">${iconSvg}</div>
    <div class="recovery-body">
      <strong>${title}</strong>
      <div>${messageHtml}</div>
      ${actionHtml}
    </div>
  `;

  if (options.allowResend && options.email) {
    const resendBtn = alertBox.querySelector("#resend-verification-btn");
    if (resendBtn) {
      if (options.cooldown) {
        startResendCooldown(resendBtn, options.cooldown);
      }
      resendBtn.addEventListener("click", () => {
        handleResendVerification(options.email, options.password, resendBtn);
      });
    }
  }
}

function hideAuthAlert() {
  const alertBox = document.querySelector("#auth-alert-box");
  if (alertBox) alertBox.hidden = true;
  if (resendInterval) {
    clearInterval(resendInterval);
    resendInterval = null;
  }
}

function startResendCooldown(button, seconds) {
  let remaining = seconds;
  button.disabled = true;
  const originalText = "Resend Verification Email";
  button.textContent = `Resend in ${remaining}s`;

  if (resendInterval) clearInterval(resendInterval);
  resendInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendInterval);
      resendInterval = null;
      button.disabled = false;
      button.textContent = originalText;
    } else {
      button.textContent = `Resend in ${remaining}s`;
    }
  }, 1000);
}

async function handleResendVerification(email, cachedPassword, buttonEl) {
  if (!email) {
    showAuthAlert("error", "Email Required", "Please enter your email in the field above.");
    return;
  }

  let pwd = cachedPassword || (authForm.password?.value || "").trim();
  if (!pwd) {
    showAuthAlert(
      "warning",
      "Password Required to Resend",
      `Please enter your password in the Password field above, then click <strong>Resend Verification Email</strong>.`,
      { allowResend: true, email: email, password: "" }
    );
    if (authForm.password) authForm.password.focus();
    return;
  }

  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Sending...";
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pwd);
    if (cred.user.emailVerified) {
      await signOut(auth);
      showAuthAlert(
        "success",
        "Already Verified!",
        "Your email is already verified. You can now log in to your tracker."
      );
      return;
    }

    await sendEmailVerification(cred.user);
    await signOut(auth);

    showAuthAlert(
      "success",
      "Verification Email Sent! ✉️",
      `A new verification link was sent to <strong>${escapeHtml(email)}</strong>.<br>Please check your inbox (and Spam folder) to verify.`,
      { allowResend: true, email: email, password: pwd, cooldown: 45 }
    );
  } catch (err) {
    showAuthAlert("error", "Could Not Resend Link", friendlyAuthError(err), {
      allowResend: true,
      email: email,
      password: pwd
    });
  }
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
    updateDirectoryUser(user);
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

// ==========================================================================
// User Notifications & Real-Time Admin Alerts
// ==========================================================================
const notificationTrigger = document.querySelector("#notification-trigger");
const notificationPopover = document.querySelector("#notification-popover");
const notificationBadge = document.querySelector("#notification-badge");
const notificationList = document.querySelector("#notification-list");
const markAllReadBtn = document.querySelector("#mark-all-read-btn");

function toggleNotificationPopover() {
  if (!notificationPopover) return;
  notificationPopover.hidden = !notificationPopover.hidden;
  if (!notificationPopover.hidden && profileDialog && profileDialog.open) {
    profileDialog.close();
  }
}

if (notificationTrigger) {
  notificationTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNotificationPopover();
  });
}

document.addEventListener("click", (e) => {
  if (notificationPopover && !notificationPopover.hidden) {
    if (!notificationPopover.contains(e.target) && !notificationTrigger?.contains(e.target)) {
      notificationPopover.hidden = true;
    }
  }
});

if (markAllReadBtn) {
  markAllReadBtn.addEventListener("click", async () => {
    if (!user) return;
    try {
      const notifRef = collection(db, "users", user.uid, "notifications");
      const unreadSnap = await getDocs(query(notifRef, where("read", "==", false)));
      const promises = [];
      unreadSnap.forEach(d => {
        promises.push(updateDoc(d.ref, { read: true }));
      });
      await Promise.all(promises);
    } catch (err) {
      console.warn("Could not mark all notifications read:", err);
    }
  });
}

function showWebToast(title, message) {
  const container = document.querySelector("#web-toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "web-toast";
  toast.innerHTML = `
    <div class="toast-icon">⚡</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-body">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" type="button" aria-label="Close notification">&times;</button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 200);
  });

  toast.addEventListener("click", (e) => {
    if (e.target.closest(".toast-close")) return;
    if (notificationPopover) notificationPopover.hidden = false;
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 200);
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 200);
    }
  }, 7000);
}

function renderNotificationsUI(notifications, unreadCount, uid) {
  if (notificationBadge) {
    if (unreadCount > 0) {
      notificationBadge.textContent = unreadCount > 9 ? "9+" : unreadCount;
      notificationBadge.hidden = false;
    } else {
      notificationBadge.hidden = true;
    }
  }

  if (!notificationList) return;

  if (notifications.length === 0) {
    notificationList.innerHTML = `<div class="notification-empty">No notifications yet. Admin replies will appear here in real-time.</div>`;
    if (markAllReadBtn) markAllReadBtn.style.display = "none";
    return;
  }

  if (markAllReadBtn) {
    markAllReadBtn.style.display = unreadCount > 0 ? "inline-block" : "none";
  }

  notificationList.innerHTML = notifications.map(notif => {
    let timeStr = "Recently";
    if (notif.createdAt && notif.createdAt.toDate) {
      timeStr = notif.createdAt.toDate().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return `
      <div class="notification-item ${notif.read ? '' : 'unread'}" data-notif-id="${escapeHtml(notif.id)}">
        <div class="notification-item-title">
          <span>${escapeHtml(notif.title || "Admin Notification")}</span>
          <span class="notification-item-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="notification-item-body">${escapeHtml(notif.message || "")}</div>
        <div class="notification-item-actions">
          ${!notif.read ? `<button type="button" class="notification-read-btn" data-action="mark-read" data-id="${escapeHtml(notif.id)}">✓ Mark as read</button>` : `<span style="font-size: 10px; color: var(--muted); font-family: var(--mono);">✓ Read</span>`}
        </div>
      </div>
    `;
  }).join("");

  notificationList.querySelectorAll("[data-action='mark-read']").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const notifId = btn.getAttribute("data-id");
      try {
        await updateDoc(doc(db, "users", uid, "notifications", notifId), {
          read: true
        });
      } catch (err) {
        console.warn("Could not mark notification read:", err);
      }
    });
  });
}

function startNotifications(currentUser) {
  if (unsubscribeNotifications) unsubscribeNotifications();

  try {
    const notifRef = collection(db, "users", currentUser.uid, "notifications");
    const notifQuery = query(notifRef, orderBy("createdAt", "desc"));

    unsubscribeNotifications = onSnapshot(notifQuery, snapshot => {
      const notifications = [];
      let unreadCount = 0;

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const notif = {
          id: docSnap.id,
          ...data
        };
        notifications.push(notif);
        if (!notif.read) {
          unreadCount++;
          if (hasInitializedNotifications && !knownNotificationIds.has(notif.id)) {
            showWebToast(notif.title || "Admin Reply Received", notif.message || "");
          }
        }
        knownNotificationIds.add(notif.id);
      });

      hasInitializedNotifications = true;
      renderNotificationsUI(notifications, unreadCount, currentUser.uid);
    }, err => {
      console.warn("Notifications listener warning:", err);
    });
  } catch (err) {
    console.warn("Notifications init error:", err);
  }
}

async function updateDirectoryUser(currentUser) {
  if (!currentUser) return;
  if (userProfile?.isSuspended === true || userProfile?.status === "suspended" || userProfile?.isDeleted) {
    return;
  }
  try {
    let streakCount = 0;
    let completedDays = 0;
    try {
      if (state) {
        streakCount = calculateStreak(state).current || 0;
        completedDays = Object.values(state.logs || {}).filter(isDayComplete).length || 0;
      }
    } catch {}

    let name = userProfile?.displayName || currentUser.displayName || "";
    if (!name) {
      try {
        const cached = localStorage.getItem(`winter-arc-profile:${currentUser.uid}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.displayName) name = parsed.displayName;
        }
      } catch {}
    }

    const dirRef = doc(db, "directory_users", currentUser.uid);
    await setDoc(dirRef, {
      uid: currentUser.uid,
      email: currentUser.email || "",
      displayName: name || "Ghost Warrior",
      currentStreak: streakCount,
      completedDays: completedDays,
      lastActive: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn("Directory user sync warning:", err);
  }
}

// Modal profile form submission
if (profileModalForm) {
  profileModalForm.addEventListener("submit", async event => {
    event.preventDefault();
    await handleProfileSave(new FormData(profileModalForm));
  });
}

// Modal action buttons & Sign Out
async function handleSignOut() {
  if (profileDialog && profileDialog.open) profileDialog.close();
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
    unsubscribeNotifications = null;
  }
  knownNotificationIds.clear();
  hasInitializedNotifications = false;
  const adminHeaderLink = document.querySelector("#admin-header-link");
  if (adminHeaderLink) adminHeaderLink.hidden = true;

  try {
    localStorage.removeItem(SESSION_FLAG);
    localStorage.setItem("winter_arc_explicit_signout", "true");
    document.documentElement.classList.remove("has-active-session");
    document.body.classList.remove("user-authenticated");
    if (globalSiteHeader) globalSiteHeader.hidden = false;
    if (appView) appView.hidden = true;
    if (authView) authView.hidden = false;
    authMode = "signin";
    hideAuthAlert();
    updateAuthMode();
    if (auth) await signOut(auth);
    showMessage("Signed out successfully.");
  } catch (error) {
    showMessage(`Sign out failed: ${friendlyAuthError(error)}`, true);
  }
}

const modalSignOut = document.querySelector("#modal-sign-out");
if (modalSignOut) {
  modalSignOut.addEventListener("click", handleSignOut);
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
  const submitBtn = document.querySelector("#auth-submit");

  if (!email) {
    authMessage.textContent = "Please enter your email.";
    return;
  }
  if (authMode === "create" && !displayName) {
    authMessage.textContent = "Please enter your name or ghost alias.";
    return;
  }

  authMessage.textContent = "";
  hideAuthAlert();

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `${authMode === "create" ? "Creating Account..." : "Signing in..."} <span aria-hidden="true">⏳</span>`;
  }

  try {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {}

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

      if (authForm.password) authForm.password.value = "";
      showVerificationScreen(email, true);

      // Send Firebase Email Verification link
      try {
        await sendEmailVerification(credential.user);
        showVerifyFeedback(
          "success",
          `Verification email sent to ${email}!\n\nCheck your Inbox and Spam/Junk folder (Sender: noreply@winter-arc-b7f5f.firebaseapp.com). Click the link in the email, then click "I've Verified My Email" below.`
        );
      } catch (verifyErr) {
        console.error("sendEmailVerification error:", verifyErr);
        showVerifyFeedback(
          "error",
          `Could not send verification email: ${friendlyAuthError(verifyErr)}. Please click "Resend Verification Email" below.`
        );
      }
      return;
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);

      // Reload user to verify freshest verification state
      await credential.user.reload();

      // Check if user's email is verified
      if (!credential.user.emailVerified) {
        showVerificationScreen(credential.user.email || email);
        showVerifyFeedback("warning", "Your email is not verified yet. Please check your inbox and click the verification link.");
        return;
      }

      // Check database status (Suspended or Deleted)
      try {
        const dirSnap = await getDoc(doc(db, "directory_users", credential.user.uid));
        if (dirSnap.exists()) {
          const dirData = dirSnap.data();
          if (dirData.isSuspended === true || dirData.status === "suspended") {
            await signOut(auth);
            localStorage.removeItem(SESSION_FLAG);
            localStorage.setItem("winter_arc_explicit_signout", "true");
            document.documentElement.classList.remove("has-active-session");
            document.body.classList.remove("user-authenticated");
            if (globalSiteHeader) globalSiteHeader.hidden = false;
            if (authView) authView.hidden = false;
            if (appView) appView.hidden = true;

            showAuthAlert(
              "warning",
              "Account Suspended",
              "Your account has been suspended by the administrator. Access to the Winter Arc tracker has been revoked."
            );
            return;
          }
          if (dirData.isDeleted === true || dirData.status === "deleted") {
            await signOut(auth);
            localStorage.removeItem(SESSION_FLAG);
            localStorage.setItem("winter_arc_explicit_signout", "true");
            document.documentElement.classList.remove("has-active-session");
            document.body.classList.remove("user-authenticated");
            if (globalSiteHeader) globalSiteHeader.hidden = false;
            if (authView) authView.hidden = false;
            if (appView) appView.hidden = true;

            showAuthAlert(
              "error",
              "Account Not Found",
              "Your account has been deleted by the administrator. Please register a new account to join."
            );
            return;
          }
        }
      } catch (errDir) {
        console.warn("Could not check account directory status:", errDir);
      }

      localStorage.setItem(SESSION_FLAG, credential.user.uid);
      localStorage.removeItem("winter_arc_explicit_signout");
      document.documentElement.classList.add("has-active-session");
      document.body.classList.add("user-authenticated");
      if (globalSiteHeader) globalSiteHeader.hidden = true;
      if (authView) authView.hidden = true;
      if (appView) appView.hidden = false;
      user = credential.user;
      startUserData(user);
      authForm.reset();
    }
  } catch (error) {
    authMessage.textContent = friendlyAuthError(error);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `${authMode === "create" ? "Start Winter Arc" : "Login"} <span aria-hidden="true">↗</span>`;
    }
  }
});

document.querySelector("#auth-switch").addEventListener("click", () => {
  authMode = authMode === "signin" ? "create" : "signin";
  hideAuthAlert();
  hideVerificationScreen();
  updateAuthMode();
});

// Verification Screen Button Listeners
if (btnCheckVerified) {
  btnCheckVerified.addEventListener("click", async () => {
    btnCheckVerified.disabled = true;
    const originalText = btnCheckVerified.innerHTML;
    btnCheckVerified.innerHTML = `Checking Verification... <span class="spin">⏳</span>`;

    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
      }

      if (auth.currentUser && auth.currentUser.emailVerified) {
        // Double check database status
        const dirSnap = await getDoc(doc(db, "directory_users", auth.currentUser.uid));
        if (dirSnap.exists()) {
          const dirData = dirSnap.data();
          if (dirData.isSuspended === true || dirData.status === "suspended") {
            await signOut(auth);
            hideVerificationScreen();
            showAuthAlert("warning", "Account Suspended", "Your account has been suspended by the administrator.");
            return;
          }
          if (dirData.isDeleted === true || dirData.status === "deleted") {
            await signOut(auth);
            hideVerificationScreen();
            showAuthAlert("error", "Account Not Found", "Your account has been deleted by the administrator.");
            return;
          }
        }

        // Email verified successfully!
        localStorage.setItem(SESSION_FLAG, auth.currentUser.uid);
        localStorage.removeItem("winter_arc_explicit_signout");
        document.documentElement.classList.add("has-active-session");
        document.body.classList.add("user-authenticated");
        if (globalSiteHeader) globalSiteHeader.hidden = true;
        if (authView) authView.hidden = true;
        if (appView) appView.hidden = false;
        user = auth.currentUser;
        startUserData(user);
        hideVerificationScreen();
        showMessage("🎉 Email verified successfully! Welcome to Winter Arc.");
      } else {
        showVerifyFeedback("warning", "Your email is not verified yet. Please check your inbox and click the verification link.");
      }
    } catch (err) {
      showVerifyFeedback("error", `Verification check error: ${friendlyAuthError(err)}`);
    } finally {
      btnCheckVerified.disabled = false;
      btnCheckVerified.innerHTML = originalText;
    }
  });
}

if (btnResendVerification) {
  btnResendVerification.addEventListener("click", async () => {
    if (!auth.currentUser) {
      showVerifyFeedback("error", "Session expired. Please click Back to Login and sign in again.");
      return;
    }

    btnResendVerification.disabled = true;
    btnResendVerification.textContent = "Sending Verification...";

    try {
      await sendEmailVerification(auth.currentUser);

      showVerifyFeedback(
        "success",
        `Verification email resent to ${auth.currentUser.email}! Please check your Inbox and Spam/Junk folder.`
      );
      
      // Start 60s cooldown
      let remaining = 60;
      btnResendVerification.textContent = `Resend available in ${remaining}s`;
      if (verifyCooldownTimer) clearInterval(verifyCooldownTimer);
      verifyCooldownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(verifyCooldownTimer);
          verifyCooldownTimer = null;
          btnResendVerification.disabled = false;
          btnResendVerification.textContent = "🔄 Resend Verification Email";
        } else {
          btnResendVerification.textContent = `Resend available in ${remaining}s`;
        }
      }, 1000);
    } catch (err) {
      btnResendVerification.disabled = false;
      btnResendVerification.textContent = "🔄 Resend Verification Email";
      console.error("Resend error:", err);
      showVerifyFeedback("error", `Could not resend email: ${friendlyAuthError(err)}`);
    }
  });
}

if (btnBackToLogin) {
  btnBackToLogin.addEventListener("click", async () => {
    const savedEmail = auth.currentUser?.email || (authForm.email?.value || "");
    if (auth) {
      try {
        await signOut(auth);
      } catch {}
    }
    hideVerificationScreen();
    authMode = "signin";
    updateAuthMode();
    if (authForm.email && savedEmail) {
      authForm.email.value = savedEmail;
    }
    if (authForm.password) {
      authForm.password.value = "";
    }
  });
}

const resetPasswordLink = document.querySelector("#reset-password");
if (resetPasswordLink) {
  resetPasswordLink.addEventListener("click", (e) => {
    const email = (authForm.email?.value || "").trim();
    if (email) {
      e.preventDefault();
      window.location.href = `/forgot?email=${encodeURIComponent(email)}`;
    }
    // If empty, normal <a href="/forgot"> navigation takes over seamlessly
  });
}

document.querySelector("#sign-out").addEventListener("click", handleSignOut);

document.querySelectorAll(".tab").forEach(tab =>
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    if (activeTab === "today") {
      selectedDate = currentActiveDay();
    }
    render();
  })
);

// Habit checklist interaction with Strict Mode guard
content.addEventListener("change", event => {
  const checkbox = event.target.closest("[data-habit-check]");
  if (!checkbox) return;
  if (!isDayEditable(selectedDate)) {
    checkbox.checked = !checkbox.checked;
    showMessage("🔒 Strict Mode: Past and future days cannot be modified!", true);
    return;
  }
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
    selectedDate = currentActiveDay();
    activeTab = "today";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (action.dataset.action === "save-today") {
    const btn = document.querySelector("#save-today-btn");
    const label = document.querySelector("#save-btn-label");
    if (btn) btn.disabled = true;
    if (label) label.textContent = "Saving...";

    const ok = await saveImmediately();
    if (btn) btn.disabled = false;
    if (ok) {
      if (btn) btn.classList.add("saved");
      if (label) label.textContent = "✓ Saved to Cloud";
      showMessage("✓ Today's progress saved & cloud-synced!");
      window.setTimeout(() => {
        if (btn) btn.classList.remove("saved");
        if (label) label.textContent = "Save Progress";
      }, 2500);
    }
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

// Journal auto-save with Strict Mode guard
content.addEventListener("input", event => {
  if (event.target.id !== "journal-entry") return;
  if (!isDayEditable(selectedDate)) {
    showMessage("🔒 Strict Mode: Past entries are locked and cannot be edited.", true);
    return;
  }
  state.journal[selectedDate] = event.target.value;
  const status = document.querySelector("#journal-status");
  if (status) status.textContent = "Saving...";
  cacheAndSync();
  window.clearTimeout(event.target.saveLabelTimer);
  event.target.saveLabelTimer = window.setTimeout(() => {
    const currentStatus = document.querySelector("#journal-status");
    if (currentStatus) currentStatus.textContent = "Saved privately to your account (Auto-lock at 12:00 AM).";
  }, 500);
});

// Midnight rollover monitor & strict lock enforcement
let lastTrackedDate = todayKey();

function checkMidnightRollover() {
  const timerEl = document.querySelector("#today-midnight-timer");
  if (timerEl) {
    timerEl.textContent = `⏳ Locks in ${getMidnightRemainingText()}`;
  }

  const currentDate = todayKey();
  if (currentDate !== lastTrackedDate) {
    console.log(`[Strict Mode] Midnight rollover: ${lastTrackedDate} -> ${currentDate}`);
    lastTrackedDate = currentDate;

    // 12:00 AM midnight reached! Auto-save today's progress immediately
    saveImmediately().then(() => {
      showMessage("🔒 Midnight reached! Previous day locked in Strict Mode. New day is now active!");
      selectedDate = currentActiveDay();
      activeTab = "today";
      render();
      updateProfileUI();
      updateCountdown();
    });
  }
}

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

  // Handle email verification action links or redirects
  const urlParams = new URLSearchParams(window.location.search);
  const isVerifiedRedirect = urlParams.get("verified") === "true";
  const actionMode = urlParams.get("mode");
  const actionCode = urlParams.get("oobCode");

  if (isVerifiedRedirect) {
    showAuthAlert(
      "success",
      "Email Verified Successfully! 🎉",
      "Your email has been verified. You can now log in to access your Winter Arc tracker."
    );
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (actionMode === "verifyEmail" && actionCode) {
    applyActionCode(auth, actionCode)
      .then(() => {
        showAuthAlert(
          "success",
          "Email Verified Successfully! 🎉",
          "Your email address is now verified. You can log in below to enter Ghost Mode."
        );
        window.history.replaceState({}, document.title, window.location.pathname);
      })
      .catch(() => {
        showAuthAlert(
          "error",
          "Verification Link Invalid or Expired",
          "This verification link is invalid or has already expired. If you haven't verified yet, please log in or click Resend Verification."
        );
      });
  }

  onAuthStateChanged(auth, async currentUser => {
    if (currentUser) {
      try {
        await currentUser.reload();
      } catch {}

      if (!currentUser.emailVerified) {
        document.documentElement.classList.remove("has-active-session");
        document.body.classList.remove("user-authenticated");
        if (globalSiteHeader) globalSiteHeader.hidden = false;
        if (appView) appView.hidden = true;
        if (authView) authView.hidden = false;
        if (!verificationPanel || verificationPanel.hidden) {
          showVerificationScreen(currentUser.email);
          showVerifyFeedback("warning", "Please check your inbox or spam folder and verify your email to access your tracker.");
        }
        return;
      }
    }

    user = currentUser;
    if (!user) {
      const explicitSignout = localStorage.getItem("winter_arc_explicit_signout") === "true";
      const hasSession = localStorage.getItem(SESSION_FLAG);
      if (explicitSignout || !hasSession) {
        if (unsubscribeState) unsubscribeState();
        if (unsubscribeProfile) unsubscribeProfile();
        unsubscribeState = null;
        unsubscribeProfile = null;
        window.clearTimeout(saveTimer);
        state = initialState();
        userProfile = null;
        authMode = "signin";
        updateAuthMode();
        document.documentElement.classList.remove("has-active-session");
        document.body.classList.remove("user-authenticated");
        if (globalSiteHeader) globalSiteHeader.hidden = false;
        appView.hidden = true;
        authView.hidden = false;
      }
      return;
    }

    localStorage.setItem(SESSION_FLAG, user.uid);
    localStorage.removeItem("winter_arc_explicit_signout");
    document.documentElement.classList.add("has-active-session");
    document.body.classList.add("user-authenticated");
    if (globalSiteHeader) globalSiteHeader.hidden = true;
    authView.hidden = true;
    appView.hidden = false;
    selectedDate = currentActiveDay();
    activeTab = "today";
    startUserData(user);
    updateCountdown();
    updateProfileUI();
  });

  window.setInterval(updateCountdown, 60_000);
  window.setInterval(checkMidnightRollover, 1000);
}
