// Winter Arc (Ghost Mode) - Universal Site Scripts
// Handles mobile navigation toggle and GDPR/CCPA cookie consent banner

(function () {
  'use strict';

  // 1. Mobile Navigation Toggle
  const toggleBtn = document.querySelector('.nav-mobile-toggle');
  const navList = document.querySelector('.site-nav-list');
  if (toggleBtn && navList) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = navList.classList.toggle('mobile-open');
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      toggleBtn.textContent = isOpen ? '✕' : '☰';
    });
  }

  // 2. Cookie & Privacy Consent Banner
  const CONSENT_KEY = 'winter_arc_cookie_consent_v1';
  if (!localStorage.getItem(CONSENT_KEY)) {
    const banner = document.createElement('aside');
    banner.className = 'cookie-banner';
    banner.setAttribute('aria-label', 'Cookie and Privacy Notice');
    banner.innerHTML = `
      <p class="cookie-text">
        We respect your privacy. Winter Arc uses essential cookies to preserve your session and anonymized analytics/ad tags to maintain this free service. Learn more in our <a href="/privacy">Privacy Policy</a>.
      </p>
      <div class="cookie-actions">
        <button type="button" class="cookie-btn-accept" id="consent-accept-btn">Accept</button>
        <button type="button" class="cookie-btn-decline" id="consent-decline-btn">Essential Only</button>
      </div>
    `;
    document.body.appendChild(banner);

    const acceptBtn = document.getElementById('consent-accept-btn');
    const declineBtn = document.getElementById('consent-decline-btn');

    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        localStorage.setItem(CONSENT_KEY, 'accepted');
        banner.remove();
      });
    }
    if (declineBtn) {
      declineBtn.addEventListener('click', () => {
        localStorage.setItem(CONSENT_KEY, 'essential_only');
        banner.remove();
      });
    }
  }
})();
