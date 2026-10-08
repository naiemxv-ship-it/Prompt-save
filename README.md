# PromptVault

A responsive personal AI Prompt Workspace built with Firebase Authentication, Firestore and Storage.

## Included

- Email/password registration and login
- Forgot-password email
- Remember-me / session persistence
- User-specific private data
- Prompt CRUD
- Prompt reference image upload
- Categories and custom categories
- Tags
- Favorites
- Recently added / copy count
- Search and filters
- Grid/list views
- Notepad with autosave-ready UX
- Save note as prompt
- Dark mode
- JSON export/import
- Responsive desktop + mobile UI
- Firestore and Storage security rules

## Firebase setup

1. In Firebase Console, open project `prompt-save-6f510`.
2. Authentication → Sign-in method → enable **Email/Password**.
3. Firestore Database → create a database.
4. Storage → create/enable Storage.
5. In your Firebase project settings, add the web app if you have not already.
6. The supplied Firebase config is already in `firebase.js`.

## Local test

Because this uses ES modules, serve the folder with a local server instead of opening `index.html` directly.

With Python:

    python -m http.server 5500

Then open:

    http://localhost:5500

## Firebase Hosting

Install Firebase CLI, log in, then from this folder:

    firebase login
    firebase use prompt-save-6f510
    firebase deploy

The included rules protect each user's data by their Firebase Auth UID.

## Important

The Firebase web API key is not a password. The important protection is Firebase Authentication plus Firestore/Storage Security Rules. Never put service-account/private keys in frontend files.

For production, consider adding App Check, email verification, rate limits, stronger validation, and a privacy/terms page.


## Image-first upload optimization
- Uploaded images are compressed in the browser to WebP before Firebase Storage upload.
- A smaller 640px thumbnail is stored for fast library/card loading.
- The larger image is capped at 1600px for prompt detail/reference use.
- Prompt metadata is saved immediately; image upload runs in the background so the UI does not wait.
- Existing image URLs remain compatible.
