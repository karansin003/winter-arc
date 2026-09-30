import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const form = document.querySelector("#recovery-form");
const emailInput = document.querySelector("#recovery-email");
const submitBtn = document.querySelector("#recovery-submit-btn");
const btnText = document.querySelector("#btn-text");
const alertBox = document.querySelector("#recovery-alert");
const inputGroup = document.querySelector("#input-group");

// Pre-fill email if passed in query string (?email=...)
const urlParams = new URLSearchParams(window.location.search);
const prefill = urlParams.get("email");
if (prefill && emailInput) {
  emailInput.value = prefill.trim();
}

function showFeedback(type, message, details = "") {
  alertBox.hidden = false;
  alertBox.className = `recovery-box ${type === "success" ? "recovery-success" : "recovery-error"}`;

  if (type === "success") {
    alertBox.innerHTML = `
      <div class="recovery-icon success-glow">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </div>
      <div class="recovery-body">
        <strong>${message}</strong>
        <p>${details}</p>
      </div>
    `;
  } else {
    alertBox.innerHTML = `
      <div class="recovery-icon error-glow">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <div class="recovery-body">
        <strong>${message}</strong>
        ${details ? `<p>${details}</p>` : ""}
      </div>
    `;
  }
}

function friendlyError(error) {
  const code = error.code || "";
  const errMap = {
    "auth/user-not-found": "No warrior account found with this email. Please check your spelling or create an account.",
    "auth/invalid-email": "Please provide a valid email address.",
    "auth/missing-email": "Please enter your email address.",
    "auth/too-many-requests": "Too many requests. Please wait a few minutes before trying again.",
    "auth/network-request-failed": "Network error. Please check your internet connection.",
    "auth/unauthorized-continue-uri": "Domain not yet allowlisted in Firebase. Please add arc-challenge.web.app to Firebase Console > Authentication > Settings > Authorized domains."
  };
  return errMap[code] || error.message || "Failed to send reset email. Please try again.";
}

let cooldownTimer = null;
function startCooldown(seconds = 30) {
  let remaining = seconds;
  submitBtn.disabled = true;
  btnText.textContent = `Resend available in ${remaining}s`;

  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      submitBtn.disabled = false;
      btnText.textContent = "Resend Reset Link";
    } else {
      btnText.textContent = `Resend available in ${remaining}s`;
    }
  }, 1000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = (emailInput.value || "").trim();

  if (!email) {
    showFeedback("error", "Email Required", "Please enter the email address you used to register.");
    emailInput.focus();
    return;
  }

  // Set loading state
  submitBtn.disabled = true;
  btnText.textContent = "Sending link...";
  alertBox.hidden = true;

  try {
    // Calling sendPasswordResetEmail without actionCodeSettings uses Firebase's default
    // handler on winter-arc-b7f5f.firebaseapp.com, which is always authorized on all domains.
    await sendPasswordResetEmail(auth, email);

    showFeedback(
      "success",
      "Reset Link Dispatched!",
      `We sent a secure password reset link to <strong>${escapeHtml(email)}</strong>.<br><br>
       Open your email inbox and click the link to set a new password. If you don't see it within 60 seconds, check your <strong>Spam or Junk</strong> folder.`
    );

    // Start 30s cooldown before allowing resend
    startCooldown(30);
  } catch (error) {
    console.error("Password reset error:", error);
    showFeedback("error", "Failed to Send Reset Link", friendlyError(error));
    submitBtn.disabled = false;
    btnText.textContent = "Send Reset Link";
  }
});

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[tag] || tag));
}
