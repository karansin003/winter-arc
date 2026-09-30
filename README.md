# Winter Arc 2026: Ghost Mode

## Firebase setup

1. Create a Firebase project and add a Web app.
2. In Firebase Authentication, enable **Email/Password**.
3. Copy the web app values into `firebase-config.js`.
4. Create a Cloud Firestore database and publish the rules in `firestore.rules`.
5. Add `localhost` to Authentication > Settings > Authorized domains if it is not already listed.

The app stores each account at `users/{Firebase UID}/winterArc/state`. Firestore rules restrict reads and writes to that signed-in UID. The browser cache is also namespaced by UID; signing in as another account never loads the previous account's local data.

## Run locally

From the Desktop folder, run:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/winter-arc-app/`. Firebase's browser SDK uses JavaScript modules, so do not open `index.html` directly with a `file://` URL.
