import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const ADMIN_EMAIL = "karansin8672@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const authGate = document.querySelector("#admin-auth-gate");
const dashboard = document.querySelector("#admin-dashboard");
const loginForm = document.querySelector("#admin-login-form");
const loginMsg = document.querySelector("#admin-login-msg");
const loginBtn = document.querySelector("#admin-login-btn");
const signoutBtn = document.querySelector("#admin-signout-btn");
const refreshBtn = document.querySelector("#admin-refresh-btn");

// Metric Counters
const metricUsersCount = document.querySelector("#metric-users-count");
const metricRequestsCount = document.querySelector("#metric-requests-count");
const metricPendingCount = document.querySelector("#metric-pending-count");
const metricStreaksCount = document.querySelector("#metric-streaks-count");

// Tab Badges
const tabInquiriesBadge = document.querySelector("#tab-inquiries-badge");
const tabUsersBadge = document.querySelector("#tab-users-badge");
const countFilterAll = document.querySelector("#count-filter-all");
const countFilterPending = document.querySelector("#count-filter-pending");
const countFilterReplied = document.querySelector("#count-filter-replied");

// Lists & Tables
const inquiriesList = document.querySelector("#inquiries-list");
const inquiriesSearch = document.querySelector("#inquiries-search");
const usersTableBody = document.querySelector("#users-table-body");
const usersSearch = document.querySelector("#users-search");
const broadcastForm = document.querySelector("#broadcast-form");
const broadcastRecipient = document.querySelector("#broadcast-recipient");
const broadcastStatus = document.querySelector("#broadcast-status");

// State
let allInquiries = [];
let allUsers = [];
let activeFilter = "all";
let unsubscribeInquiries = null;
let unsubscribeUsers = null;

// Auth State Observer
try {
  setPersistence(auth, browserLocalPersistence);
} catch {}

onAuthStateChanged(auth, user => {
  if (user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    showDashboard(user);
  } else {
    showAuthGate();
  }
});

function showAuthGate() {
  if (unsubscribeInquiries) { unsubscribeInquiries(); unsubscribeInquiries = null; }
  if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
  authGate.style.display = "block";
  dashboard.style.display = "none";
}

async function showDashboard(adminUser) {
  authGate.style.display = "none";
  dashboard.style.display = "block";
  await syncAdminToDirectory(adminUser);
  startRealtimeListeners();
  await refreshAdminData(false);
}

// Password Visibility Toggle
const adminPasswordInput = document.querySelector("#admin-password");
const adminTogglePasswordBtn = document.querySelector("#admin-toggle-password");

if (adminTogglePasswordBtn && adminPasswordInput) {
  adminTogglePasswordBtn.addEventListener("click", () => {
    const isPassword = adminPasswordInput.type === "password";
    adminPasswordInput.type = isPassword ? "text" : "password";
    adminTogglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    adminTogglePasswordBtn.title = isPassword ? "Hide password" : "Show password";
    const slash = adminTogglePasswordBtn.querySelector(".eye-slash");
    if (slash) slash.style.display = isPassword ? "block" : "none";
  });
}

// Login Handler
if (loginForm) {
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    loginMsg.textContent = "";
    loginBtn.disabled = true;
    loginBtn.textContent = "Verifying...";

    const email = document.querySelector("#admin-email").value.trim();
    const password = document.querySelector("#admin-password").value;

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (cred.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        await signOut(auth);
        loginMsg.textContent = "Access denied: Unauthorized account.";
        loginBtn.disabled = false;
        loginBtn.textContent = "Unlock Command Center →";
        return;
      }
      showToast("Access Granted", "Welcome to Admin Command Center.");
    } catch (err) {
      loginMsg.textContent = err.message.replace("Firebase: ", "");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Unlock Command Center →";
    }
  });
}

// Sign Out Handler
if (signoutBtn) {
  signoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.reload();
  });
}

// Refresh Handler
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    await refreshAdminData(true);
  });
}

// Tabs Switching
const tabButtons = document.querySelectorAll(".admin-tab-btn");
const tabSections = {
  inquiries: document.querySelector("#section-inquiries"),
  users: document.querySelector("#section-users"),
  broadcast: document.querySelector("#section-broadcast")
};

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-tab");
    tabButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    Object.keys(tabSections).forEach(key => {
      if (tabSections[key]) {
        tabSections[key].style.display = key === tab ? "block" : "none";
      }
    });

    if (tab === "users") {
      renderUsers();
    } else if (tab === "inquiries") {
      renderInquiries();
    }
  });
});

// Filter Buttons (All / Pending / Replied)
const filterButtons = document.querySelectorAll(".admin-filter-btn");
filterButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    filterButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.getAttribute("data-filter");
    renderInquiries();
  });
});

// Search Filter
if (inquiriesSearch) {
  inquiriesSearch.addEventListener("input", () => renderInquiries());
}
if (usersSearch) {
  usersSearch.addEventListener("input", () => renderUsers());
}

// Auto-register Super Admin to Directory
async function syncAdminToDirectory(adminUser) {
  if (!adminUser) return;
  try {
    const adminDocRef = doc(db, "directory_users", adminUser.uid);
    await setDoc(adminDocRef, {
      uid: adminUser.uid,
      email: adminUser.email || ADMIN_EMAIL,
      displayName: adminUser.displayName || "Super Admin (Karan)",
      role: "admin",
      lastActive: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn("Could not sync admin to directory:", err);
  }
}

// Auto-discover users from support requests if not present in directory
function mergeInquiriesIntoUsers() {
  const existingUids = new Set(allUsers.map(u => u.uid || u.id));
  const existingEmails = new Set(allUsers.map(u => (u.email || "").toLowerCase()).filter(Boolean));

  allInquiries.forEach(inq => {
    const uid = inq.userId;
    const email = (inq.userEmail || "").toLowerCase();

    if (uid && !existingUids.has(uid)) {
      existingUids.add(uid);
      if (email) existingEmails.add(email);
      allUsers.push({
        id: uid,
        uid: uid,
        displayName: inq.userName || "Participant",
        email: inq.userEmail || "",
        currentStreak: 0,
        completedDays: 0,
        lastActive: inq.createdAt,
        isGuest: false
      });
    } else if (!uid && email && !existingEmails.has(email)) {
      existingEmails.add(email);
      allUsers.push({
        id: inq.id,
        uid: "",
        displayName: inq.userName || "Guest Inquiry",
        email: inq.userEmail,
        currentStreak: 0,
        completedDays: 0,
        lastActive: inq.createdAt,
        isGuest: true
      });
    }
  });
}

// Direct Cloud Sync and Active Refresh
async function refreshAdminData(manual = false) {
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = `<span class="spin">🔄</span> Syncing...`;
  }

  if (manual) {
    showToast("Refreshing Data", "Syncing all Firestore records from Cloud...");
    if (usersTableBody && allUsers.length === 0) {
      usersTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 36px; color: var(--muted); font: 12px var(--mono);">
            <span class="spin">🔄</span> Querying latest records from Cloud Firestore...
          </td>
        </tr>
      `;
    }
  }

  try {
    // 1. Fetch Directory Users actively from server
    const usersRef = collection(db, "directory_users");
    const usersSnap = await getDocs(usersRef);
    const usersList = [];
    let totalStreaks = 0;

    usersSnap.forEach(docSnap => {
      const u = {
        id: docSnap.id,
        ...docSnap.data()
      };
      usersList.push(u);
      if (u.currentStreak && Number(u.currentStreak) > 0) {
        totalStreaks += Number(u.currentStreak);
      }
    });

    allUsers = usersList;

    // 2. Fetch Support Requests
    const reqRef = collection(db, "support_requests");
    const reqQuery = query(reqRef, orderBy("createdAt", "desc"));
    const reqSnap = await getDocs(reqQuery);

    allInquiries = [];
    reqSnap.forEach(docSnap => {
      allInquiries.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    // Auto-discover users who contacted support
    mergeInquiriesIntoUsers();

    // Recompute metrics
    totalStreaks = allUsers.reduce((sum, u) => sum + (Number(u.currentStreak) || 0), 0);
    metricUsersCount.textContent = allUsers.length;
    metricStreaksCount.textContent = totalStreaks;
    tabUsersBadge.textContent = allUsers.length;

    updateInquiryMetrics();
    renderInquiries();
    renderUsers();
    updateBroadcastRecipients();

    if (manual) {
      showToast("Sync Complete", `Loaded ${allUsers.length} user(s) and ${allInquiries.length} support ticket(s).`);
    }
  } catch (err) {
    console.error("Refresh error:", err);
    if (manual) {
      showToast("Sync Error", err.message || "Failed to sync records.");
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `🔄 Refresh`;
    }
  }
}

// Start Real-Time Listeners
function startRealtimeListeners() {
  if (unsubscribeInquiries) unsubscribeInquiries();
  if (unsubscribeUsers) unsubscribeUsers();

  // 1. Support Requests Listener
  try {
    const reqRef = collection(db, "support_requests");
    const reqQuery = query(reqRef, orderBy("createdAt", "desc"));

    unsubscribeInquiries = onSnapshot(reqQuery, snapshot => {
      allInquiries = [];
      snapshot.forEach(docSnap => {
        allInquiries.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });
      mergeInquiriesIntoUsers();
      updateInquiryMetrics();
      renderInquiries();
    }, err => {
      console.warn("Could not listen to support requests:", err);
      if (inquiriesList) {
        inquiriesList.innerHTML = `<div style="padding: 24px; color: #ff3b30; text-align: center;">Firestore error: ${escapeHtml(err.message)}</div>`;
      }
    });
  } catch (err) {
    console.error("Error setting inquiries listener:", err);
  }

  // 2. Directory Users Listener
  try {
    const usersRef = collection(db, "directory_users");
    unsubscribeUsers = onSnapshot(usersRef, snapshot => {
      const usersList = [];
      let totalStreaks = 0;

      snapshot.forEach(docSnap => {
        const u = {
          id: docSnap.id,
          ...docSnap.data()
        };
        usersList.push(u);
        if (u.currentStreak && Number(u.currentStreak) > 0) {
          totalStreaks += Number(u.currentStreak);
        }
      });

      allUsers = usersList;
      mergeInquiriesIntoUsers();

      totalStreaks = allUsers.reduce((sum, u) => sum + (Number(u.currentStreak) || 0), 0);
      metricUsersCount.textContent = allUsers.length;
      metricStreaksCount.textContent = totalStreaks;
      tabUsersBadge.textContent = allUsers.length;

      updateBroadcastRecipients();
      renderUsers();
    }, err => {
      console.warn("Could not listen to directory users:", err);
      if (usersTableBody) {
        usersTableBody.innerHTML = `<tr><td colspan="6" style="padding: 24px; color: #ff3b30; text-align: center;">Error loading users: ${escapeHtml(err.message)}</td></tr>`;
      }
    });
  } catch (err) {
    console.error("Error setting users listener:", err);
  }
}

// Update Inquiry Metrics
function updateInquiryMetrics() {
  const total = allInquiries.length;
  const pending = allInquiries.filter(i => (i.status || "pending") === "pending").length;
  const replied = allInquiries.filter(i => i.status === "replied").length;

  metricRequestsCount.textContent = total;
  metricPendingCount.textContent = pending;

  countFilterAll.textContent = total;
  countFilterPending.textContent = pending;
  countFilterReplied.textContent = replied;

  if (pending > 0) {
    tabInquiriesBadge.textContent = pending;
    tabInquiriesBadge.style.display = "inline-block";
  } else {
    tabInquiriesBadge.style.display = "none";
  }
}

// Render Inquiries List
function renderInquiries() {
  if (!inquiriesList) return;

  const queryTerm = (inquiriesSearch?.value || "").toLowerCase().trim();

  let filtered = allInquiries.filter(item => {
    // Status filter
    const status = item.status || "pending";
    if (activeFilter === "pending" && status !== "pending") return false;
    if (activeFilter === "replied" && status !== "replied") return false;

    // Search query filter
    if (queryTerm) {
      const name = (item.userName || "").toLowerCase();
      const email = (item.userEmail || "").toLowerCase();
      const category = (item.category || "").toLowerCase();
      const message = (item.message || "").toLowerCase();
      if (!name.includes(queryTerm) && !email.includes(queryTerm) && !category.includes(queryTerm) && !message.includes(queryTerm)) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    inquiriesList.innerHTML = `
      <div style="padding: 48px; text-align: center; background: #141812; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted);">
        <p style="font-size: 15px; margin-bottom: 6px;">No inquiries found matching criteria.</p>
        <small style="font: 11px var(--mono);">Any support requests submitted by users or visitors will appear here automatically in real-time.</small>
      </div>
    `;
    return;
  }

  inquiriesList.innerHTML = filtered.map(item => {
    const isPending = (item.status || "pending") === "pending";
    const initial = (item.userName || item.userEmail || "U")[0].toUpperCase();

    let createdTime = "Recently";
    if (item.createdAt && item.createdAt.toDate) {
      createdTime = item.createdAt.toDate().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    let repliedTime = "";
    if (item.repliedAt && item.repliedAt.toDate) {
      repliedTime = item.repliedAt.toDate().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return `
      <article class="admin-request-card ${isPending ? 'pending' : 'replied'}" id="ticket-${item.id}">
        <div class="admin-request-top">
          <div class="admin-request-user">
            <div class="admin-user-avatar">${escapeHtml(initial)}</div>
            <div>
              <div class="admin-req-name">${escapeHtml(item.userName || "Anonymous Ghost")}</div>
              <div class="admin-req-email">${escapeHtml(item.userEmail || "No email provided")}</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font: 11px var(--mono); color: var(--muted);">${escapeHtml(createdTime)}</span>
            <span class="admin-status-badge ${isPending ? 'pending' : 'replied'}">
              ${isPending ? '🔴 PENDING REPLY' : '🟢 REPLIED'}
            </span>
          </div>
        </div>

        <div>
          <span class="admin-request-category">Category: ${escapeHtml(item.category || "General Support")}</span>
        </div>

        <div class="admin-request-body">${escapeHtml(item.message || "(No message body)")}</div>

        ${item.adminReply ? `
          <div class="admin-reply-box">
            <div class="admin-reply-header">
              <span>✓ OFFICIAL ADMIN REPLY</span>
              <span style="font-weight: 400; color: var(--muted);">${escapeHtml(repliedTime)}</span>
            </div>
            <div class="admin-reply-text">${escapeHtml(item.adminReply)}</div>
          </div>
        ` : ''}

        <!-- Reply Form for Admin -->
        <div class="admin-reply-form">
          <div class="admin-templates-bar">
            <span style="font: 10px var(--mono); color: var(--muted); align-self: center;">Quick Templates:</span>
            <button type="button" class="admin-template-btn" data-ticket="${item.id}" data-text="Your issue has been investigated and resolved. Thank you for your discipline.">✓ Resolved</button>
            <button type="button" class="admin-template-btn" data-ticket="${item.id}" data-text="Password recovery instructions have been dispatched. Check your inbox and spam folder.">✓ Recovery Sent</button>
            <button type="button" class="admin-template-btn" data-ticket="${item.id}" data-text="Thank you for your feedback! Our team has recorded this enhancement for the 2026 Winter Arc grid.">✓ Feedback Noted</button>
          </div>

          <textarea class="admin-reply-textarea" id="reply-input-${item.id}" placeholder="Write official reply to ${escapeHtml(item.userName || 'user')}... This will notify their webpage directly.">${item.adminReply || ''}</textarea>

          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span style="font: 11px var(--mono); color: var(--muted);">
              ${item.userId ? '✓ Linked to registered user account' : 'Guest inquiry (will link if user signs up with ' + escapeHtml(item.userEmail || '') + ')'}
            </span>
            <button type="button" class="admin-send-btn" data-action="send-reply" data-ticket="${item.id}">
              <span>🚀</span> ${isPending ? 'Send Reply & Notify User on Webpage' : 'Update Reply & Re-Notify User'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // Attach quick template listeners
  inquiriesList.querySelectorAll(".admin-template-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ticketId = btn.getAttribute("data-ticket");
      const text = btn.getAttribute("data-text");
      const textarea = document.querySelector(`#reply-input-${ticketId}`);
      if (textarea) textarea.value = text;
    });
  });

  // Attach Send Reply Click
  inquiriesList.querySelectorAll("[data-action='send-reply']").forEach(btn => {
    btn.addEventListener("click", () => handleSendReply(btn.getAttribute("data-ticket"), btn));
  });
}

// Send Reply Action
async function handleSendReply(ticketId, btnElement) {
  const textarea = document.querySelector(`#reply-input-${ticketId}`);
  if (!textarea) return;

  const replyText = textarea.value.trim();
  if (!replyText) {
    alert("Please enter a reply message before dispatching.");
    return;
  }

  const ticket = allInquiries.find(i => i.id === ticketId);
  if (!ticket) return;

  btnElement.disabled = true;
  btnElement.textContent = "Transmitting to User Webpage...";

  try {
    // 1. Update support_requests document
    await updateDoc(doc(db, "support_requests", ticketId), {
      status: "replied",
      adminReply: replyText,
      repliedAt: serverTimestamp()
    });

    // 2. Locate target User ID to dispatch webpage notification
    let targetUid = ticket.userId;

    if (!targetUid && ticket.userEmail) {
      // Find matching user in directory_users by email
      const matched = allUsers.find(u => u.email && u.email.toLowerCase() === ticket.userEmail.toLowerCase());
      if (matched) {
        targetUid = matched.uid || matched.id;
      }
    }

    if (targetUid) {
      // 3. Write notification directly to user's notifications subcollection
      await addDoc(collection(db, "users", targetUid, "notifications"), {
        title: `Admin Reply: ${ticket.category || 'Support Inquiry'}`,
        message: replyText,
        requestId: ticketId,
        read: false,
        type: "admin_reply",
        createdAt: serverTimestamp()
      });
      showToast("Notification Dispatched", `Live notification sent to ${ticket.userName || 'user'}'s webpage.`);
    } else {
      showToast("Reply Saved", "Reply saved to ticket. (User was guest; when they log in, ticket is documented).");
    }
  } catch (err) {
    console.error("Failed to send reply:", err);
    alert("Error sending reply: " + err.message);
  } finally {
    btnElement.disabled = false;
    btnElement.textContent = "Send Reply & Notify User on Webpage";
  }
}

// Render Users Directory
function renderUsers() {
  if (!usersTableBody) return;

  const queryTerm = (usersSearch?.value || "").toLowerCase().trim();

  let filtered = allUsers.filter(u => {
    if (queryTerm) {
      const email = (u.email || "").toLowerCase();
      const alias = (u.displayName || "").toLowerCase();
      const uid = (u.uid || u.id || "").toLowerCase();
      if (!email.includes(queryTerm) && !alias.includes(queryTerm) && !uid.includes(queryTerm)) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    usersTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 48px 20px; color: var(--muted);">
          <div style="font-size: 32px; margin-bottom: 10px;">👥</div>
          <div style="font-size: 16px; font-weight: 700; color: var(--paper); margin-bottom: 6px;">
            ${queryTerm ? 'No users matching "' + escapeHtml(queryTerm) + '"' : 'No Users in Directory Yet'}
          </div>
          <p style="font: 12px var(--mono); color: var(--muted); max-width: 440px; margin: 0 auto 18px; line-height: 1.6;">
            ${queryTerm ? 'Try adjusting your search criteria.' : 'Users sync here in real-time as soon as they log into the app, update profiles, or submit support tickets.'}
          </p>
          <button type="button" class="small-button" id="force-users-refresh-btn" style="display: inline-flex; align-items: center; gap: 6px;">
            <span>🔄</span> Force Sync from Cloud
          </button>
        </td>
      </tr>
    `;
    const forceBtn = document.querySelector("#force-users-refresh-btn");
    if (forceBtn) {
      forceBtn.addEventListener("click", () => refreshAdminData(true));
    }
    return;
  }

  usersTableBody.innerHTML = filtered.map(u => {
    let lastActiveStr = "Recently";
    if (u.lastActive) {
      try {
        const d = u.lastActive.toDate ? u.lastActive.toDate() : new Date(u.lastActive);
        if (!isNaN(d.getTime())) {
          lastActiveStr = d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
        }
      } catch {}
    }

    const streak = Number(u.currentStreak) || 0;
    const days = Number(u.completedDays) || 0;
    const isAdminUser = (u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) || u.role === "admin";
    const userUid = u.uid || u.id || "";
    const isSuspended = u.isSuspended === true || u.status === "suspended";

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <div style="font-weight: 700; color: var(--paper);">${escapeHtml(u.displayName || "Ghost Warrior")}</div>
            ${isAdminUser ? '<span style="font: 9px var(--mono); font-weight: 700; background: rgba(213,255,84,0.18); color: var(--lime); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(213,255,84,0.35);">ADMIN</span>' : ''}
            ${u.isGuest ? '<span style="font: 9px var(--mono); font-weight: 700; background: rgba(255,159,10,0.15); color: #ff9f0a; padding: 2px 6px; border-radius: 4px;">GUEST</span>' : ''}
          </div>
          <div style="font: 10px var(--mono); color: var(--muted); cursor: pointer;" title="UID: ${escapeHtml(userUid)}">
            ${escapeHtml(userUid.substring(0, 16))}${userUid.length > 16 ? '...' : ''}
          </div>
        </td>
        <td style="font-family: var(--mono); font-size: 12px; color: var(--lime);">${escapeHtml(u.email || "No email")}</td>
        <td>
          ${isSuspended ?
            '<span class="admin-status-badge" style="background: rgba(255,107,74,0.18); color: var(--orange); border: 1px solid rgba(255,107,74,0.35); padding: 3px 8px; border-radius: 4px; font: 700 10px var(--mono);">🔴 SUSPENDED</span>' :
            '<span class="admin-status-badge" style="background: rgba(213,255,84,0.15); color: var(--lime); border: 1px solid rgba(213,255,84,0.3); padding: 3px 8px; border-radius: 4px; font: 700 10px var(--mono);">🟢 ACTIVE</span>'
          }
        </td>
        <td>
          <span style="font-weight: 700; color: ${streak > 0 ? 'var(--lime)' : 'var(--muted)'};">
            ${streak > 0 ? '🔥 ' + streak + ' days' : '0 days'}
          </span>
        </td>
        <td>${days} / 92</td>
        <td style="font: 11px var(--mono); color: var(--muted);">${escapeHtml(lastActiveStr)}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="small-button" data-action="notify-user" data-uid="${escapeHtml(userUid)}" data-name="${escapeHtml(u.displayName || u.email || 'User')}">
              ✉️ Notify
            </button>
            ${!isAdminUser ? `
              <button type="button" class="small-button ${isSuspended ? 'success' : 'warning'}" data-action="toggle-suspend" data-uid="${escapeHtml(userUid)}" data-name="${escapeHtml(u.displayName || u.email || 'User')}" data-suspended="${isSuspended ? 'true' : 'false'}">
                ${isSuspended ? '▶️ Unsuspend' : '⏸️ Suspend'}
              </button>
              <button type="button" class="small-button danger" data-action="delete-user" data-uid="${escapeHtml(userUid)}" data-name="${escapeHtml(u.displayName || u.email || 'User')}">
                🗑️ Delete
              </button>
            ` : '<span style="font: 10px var(--mono); color: var(--muted); padding: 4px 6px;">(Admin Account)</span>'}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Notify button in user row
  usersTableBody.querySelectorAll("[data-action='notify-user']").forEach(btn => {
    btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-uid");
      const name = btn.getAttribute("data-name");

      // Switch to broadcast tab and pre-select user
      const broadcastTabBtn = document.querySelector("[data-tab='broadcast']");
      if (broadcastTabBtn) broadcastTabBtn.click();

      if (broadcastRecipient) {
        broadcastRecipient.value = uid;
      }
      const titleInput = document.querySelector("#broadcast-title");
      if (titleInput) {
        titleInput.value = `Personal Notification for ${name}`;
        titleInput.focus();
      }
    });
  });

  // Toggle Suspend / Unsuspend action
  usersTableBody.querySelectorAll("[data-action='toggle-suspend']").forEach(btn => {
    btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-uid");
      const name = btn.getAttribute("data-name");
      const isSuspended = btn.getAttribute("data-suspended") === "true";
      handleToggleSuspendUser(uid, isSuspended, name, btn);
    });
  });

  // Delete User action
  usersTableBody.querySelectorAll("[data-action='delete-user']").forEach(btn => {
    btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-uid");
      const name = btn.getAttribute("data-name");
      handleDeleteUser(uid, name, btn);
    });
  });
}

// Suspend / Unsuspend User in Database
async function handleToggleSuspendUser(uid, currentSuspended, userName, btnElement) {
  const willSuspend = !currentSuspended;
  const actionWord = willSuspend ? "SUSPEND" : "UNSUSPEND (REACTIVATE)";

  const confirmed = confirm(
    `Are you sure you want to ${actionWord} the account for "${userName}"?\n\n` +
    (willSuspend
      ? "• The user will be immediately logged out of their tracker.\n• Future sign-ins will be blocked."
      : "• The user's account will be reactivated and they can log in normally.")
  );
  if (!confirmed) return;

  btnElement.disabled = true;
  const originalText = btnElement.innerHTML;
  btnElement.innerHTML = `<span class="spin">⏳</span> Processing...`;

  try {
    const newStatus = willSuspend ? "suspended" : "active";

    // 1. Update directory_users doc in Firestore
    const dirRef = doc(db, "directory_users", uid);
    await updateDoc(dirRef, {
      status: newStatus,
      isSuspended: willSuspend,
      statusUpdatedAt: serverTimestamp()
    });

    // 2. Update user's profile doc in Firestore (triggers real-time kickout for active session)
    try {
      const profileRef = doc(db, "users", uid, "winterArc", "profile");
      await setDoc(profileRef, {
        status: newStatus,
        isSuspended: willSuspend,
        statusUpdatedAt: serverTimestamp()
      }, { merge: true });
    } catch (profileErr) {
      console.warn("Could not update user profile doc:", profileErr);
    }

    // 3. Dispatch an official notification to user subcollection
    try {
      await addDoc(collection(db, "users", uid, "notifications"), {
        title: willSuspend ? "Account Suspended" : "Account Reactivated",
        message: willSuspend
          ? "Your account has been suspended by the administrator. Access to the tracker has been restricted."
          : "Your account has been reactivated. You can now access your daily tracker.",
        read: false,
        type: willSuspend ? "account_suspended" : "account_reactivated",
        createdAt: serverTimestamp()
      });
    } catch {}

    // Update local state and re-render
    const targetUser = allUsers.find(u => (u.uid || u.id) === uid);
    if (targetUser) {
      targetUser.status = newStatus;
      targetUser.isSuspended = willSuspend;
    }

    showToast(
      willSuspend ? "User Suspended" : "User Reactivated",
      `"${userName}" has been ${willSuspend ? "suspended" : "reactivated"} successfully.`
    );
    renderUsers();
  } catch (err) {
    console.error("Failed to toggle user suspension:", err);
    alert("Error updating user status: " + err.message);
  } finally {
    btnElement.disabled = false;
    btnElement.innerHTML = originalText;
  }
}

// Delete User from Database
async function handleDeleteUser(uid, userName, btnElement) {
  const confirmed = confirm(
    `⚠️ PERMANENT DELETE WARNING ⚠️\n\n` +
    `Are you sure you want to permanently delete the account for "${userName}"?\n\n` +
    `• Their tracker logs and streak data will be permanently wiped from the database.\n` +
    `• Their directory profile will be deleted.\n\n` +
    `This action CANNOT be undone.`
  );
  if (!confirmed) return;

  const safetyCheck = prompt(`Type DELETE in all capital letters to confirm permanent deletion of "${userName}":`);
  if (safetyCheck !== "DELETE") {
    alert("Deletion cancelled. Confirmation text did not match.");
    return;
  }

  btnElement.disabled = true;
  btnElement.innerHTML = `<span class="spin">⏳</span> Deleting...`;

  try {
    // 1. Mark profile as deleted (triggers immediate kickout if user has active session)
    try {
      const profileRef = doc(db, "users", uid, "winterArc", "profile");
      await setDoc(profileRef, {
        isDeleted: true,
        status: "deleted",
        deletedAt: serverTimestamp(),
        displayName: "[Deleted User]"
      }, { merge: true });
    } catch {}

    // 2. Delete state document
    try {
      await deleteDoc(doc(db, "users", uid, "winterArc", "state"));
    } catch {}

    // 3. Delete directory_users document from Firestore
    await deleteDoc(doc(db, "directory_users", uid));

    // 4. Remove from local allUsers list and update metrics
    allUsers = allUsers.filter(u => (u.uid || u.id) !== uid);
    totalStreaks = allUsers.reduce((sum, u) => sum + (Number(u.currentStreak) || 0), 0);
    if (metricUsersCount) metricUsersCount.textContent = allUsers.length;
    if (metricStreaksCount) metricStreaksCount.textContent = totalStreaks;
    if (tabUsersBadge) tabUsersBadge.textContent = allUsers.length;
    updateBroadcastRecipients();
    renderUsers();

    showToast("User Deleted", `User "${userName}" has been permanently deleted from the database.`);
  } catch (err) {
    console.error("Failed to delete user:", err);
    alert("Error deleting user from database: " + err.message);
  }
}


// Update Broadcast Dropdown Options
function updateBroadcastRecipients() {
  if (!broadcastRecipient) return;
  const currentVal = broadcastRecipient.value;

  let optionsHtml = `<option value="ALL">🌐 Broadcast to ALL Registered Users (${allUsers.length})</option>`;
  allUsers.forEach(u => {
    const label = `${u.displayName || 'Ghost'} (${u.email || u.uid})`;
    optionsHtml += `<option value="${u.uid || u.id}">👤 ${escapeHtml(label)}</option>`;
  });
  broadcastRecipient.innerHTML = optionsHtml;
  if (currentVal) broadcastRecipient.value = currentVal;
}

// Broadcast Form Submission
if (broadcastForm) {
  broadcastForm.addEventListener("submit", async e => {
    e.preventDefault();
    const recipient = broadcastRecipient.value;
    const title = document.querySelector("#broadcast-title").value.trim();
    const message = document.querySelector("#broadcast-message").value.trim();
    const submitBtn = document.querySelector("#broadcast-submit-btn");

    if (!title || !message) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Broadcasting to Webpages...";
    broadcastStatus.innerHTML = "";

    try {
      if (recipient === "ALL") {
        let sentCount = 0;
        const promises = allUsers.map(async u => {
          const uid = u.uid || u.id;
          if (uid) {
            await addDoc(collection(db, "users", uid, "notifications"), {
              title: title,
              message: message,
              type: "broadcast",
              read: false,
              createdAt: serverTimestamp()
            });
            sentCount++;
          }
        });
        await Promise.all(promises);
        broadcastStatus.innerHTML = `<div class="recovery-success">✓ Broadcast dispatched successfully to ${sentCount} user dashboards!</div>`;
      } else {
        await addDoc(collection(db, "users", recipient, "notifications"), {
          title: title,
          message: message,
          type: "direct_message",
          read: false,
          createdAt: serverTimestamp()
        });
        broadcastStatus.innerHTML = `<div class="recovery-success">✓ Personal notification sent directly to recipient's dashboard!</div>`;
      }
      broadcastForm.reset();
      showToast("Notification Sent", "Delivered to user webpage(s).");
    } catch (err) {
      broadcastStatus.innerHTML = `<div class="recovery-error">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "🚀 Dispatch Notification to Webpage";
    }
  });
}

// Floating Toast Notification
function showToast(title, body) {
  const container = document.querySelector("#web-toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "web-toast";
  toast.innerHTML = `
    <div class="toast-icon">⚡</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-body">${escapeHtml(body)}</div>
    </div>
    <button class="toast-close" type="button" aria-label="Close notification">&times;</button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 200);
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 200);
    }
  }, 5000);
}

function escapeHtml(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
