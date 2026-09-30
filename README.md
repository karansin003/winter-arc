# ❄️ Winter Arc 2026 — Ghost Mode

A Firebase-powered web app for the **Winter Arc 2026** challenge.

🌐 **Live Website:** https://arc-challenge.web.app/

## ✨ Overview

Winter Arc 2026 — Ghost Mode keeps each user's application state tied to their own Firebase account.

User state is stored at:

```text
users/{Firebase UID}/winterArc/state
```

Firestore rules restrict reads and writes to the signed-in user's UID. Browser cache is also namespaced by UID, so one account does not load another account's local data.

## 🛠️ Tech Stack

- HTML
- CSS
- JavaScript
- Firebase Authentication
- Cloud Firestore
- Firebase Browser SDK
- Firebase Hosting
- Python HTTP Server for local development

## 🔥 Firebase Setup

### 1. Create a Firebase project

Create a Firebase project and add a **Web App**.

### 2. Enable Authentication

Go to:

```text
Firebase Console → Authentication → Sign-in method
```

Enable **Email/Password**.

### 3. Add Firebase configuration

Copy the Firebase Web App configuration into:

```text
firebase-config.js
```

### 4. Create Firestore

Create a Cloud Firestore database and apply the rules from:

```text
firestore.rules
```

### 5. Authorize local development

Make sure `localhost` is included in Firebase Authentication → Settings → Authorized domains.

## 💻 Run Locally

Do **not** open `index.html` directly with a `file://` URL because the Firebase browser SDK uses JavaScript modules.

From the project/Desktop folder:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/winter-arc-app/
```

## 📁 Important Files

| File | Purpose |
|---|---|
| `index.html` | Main application page |
| `firebase-config.js` | Firebase Web App configuration |
| `firestore.rules` | Firestore security rules |
| `README.md` | Project documentation |

## 🔐 Security

The app uses account-level data isolation.

### Firestore

```text
users/{Firebase UID}/winterArc/state
```

Firestore rules should allow a user to access only their own data.

### Browser Storage

Local browser data is namespaced by Firebase UID. Signing into another account does not load the previous account's local data.

### Never publish

- Firebase Admin SDK credentials
- Service-account private keys
- Passwords
- API secrets
- Private environment variables

## 🌐 Deployment Checklist

Before production deployment:

- [ ] Firebase project configured
- [ ] Email/Password authentication enabled
- [ ] Firestore created
- [ ] Firestore rules deployed
- [ ] Production domain authorized
- [ ] Authentication tested
- [ ] Firestore data tested
- [ ] Mobile layout tested

Production URL:

```text
https://arc-challenge.web.app/
```

## 🧪 Testing Checklist

- [ ] Website loads correctly
- [ ] User can create an account
- [ ] User can sign in
- [ ] User can sign out
- [ ] User data saves correctly
- [ ] User data restores after sign-in
- [ ] Different accounts remain isolated
- [ ] Firestore rules prevent unauthorized access
- [ ] Production authentication works

## 🛠️ Troubleshooting

### Authentication does not work locally

Check that `localhost` exists under:

```text
Firebase Console → Authentication → Settings → Authorized domains
```

### `index.html` does not work directly

Use:

```bash
python3 -m http.server 8000
```

and open:

```text
http://localhost:8000/winter-arc-app/
```

### Firestore permission denied

Check that:

1. The user is signed in.
2. The Firebase UID is correct.
3. Firestore rules are deployed.
4. The app uses:

```text
users/{Firebase UID}/winterArc/state
```

## 📌 Project Information

**Project:** Winter Arc 2026 — Ghost Mode  
**Platform:** Web  
**Backend:** Firebase Authentication + Cloud Firestore  
**Hosting:** Firebase Hosting

## 👨‍💻 Author

**Karan Kumar**

Built for the **Winter Arc 2026** challenge.

## ⭐ Try the App

https://arc-challenge.web.app/
