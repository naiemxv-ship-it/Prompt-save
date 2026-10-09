# PromptVault

A responsive personal AI Prompt Workspace built with Firebase Authentication, Firestore and Storage.

## Included

- Email/password registration and login
- Forgot-password email
- Remember-me / session persistence
- User-specific private data
- Prompt CRUD
- Local image-to-ASCII conversion (original image stays in the browser)
- ASCII preview controls: width/detail, brightness, contrast, character set, invert
- ASCII characters, per-character color data and conversion settings are stored in Firestore; original images are never uploaded
- Categories and custom categories
- Tags
- Favorites with a working Favorites page
- Recently Used page (updates when prompts are opened or copied)
- Recently added / copy count
- Search and filters
- Grid/list views
- Gallery-style Notepad with saved notes, rich-text formatting (bold, italic, underline, alignment, lists), edit and delete
- Save note as prompt
- Dark mode
- JSON export/import that preserves prompt IDs, ASCII text, colors, settings, favorites and notes
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

The included Firestore rules protect each user's data by their Firebase Auth UID. The Storage rules separately allow an authenticated user to read/delete only their own legacy image files, and limit uploads to under 10 MB. New ASCII-only prompts do not upload image files.

## Important

The Firebase web API key is not a password. The important protection is Firebase Authentication plus Firestore/Storage Security Rules. Never put service-account/private keys in frontend files.

For production, consider adding App Check, email verification, rate limits, stronger validation, and a privacy/terms page.


## ASCII-only reference images
- The original image is processed locally in the browser using Canvas.
- The app converts the pixels into ASCII characters and shows a live preview.
- Basic controls: output width/detail, brightness, contrast, character set, and invert.
- The ASCII text, sampled colors and settings are stored in Firestore. New image files are never uploaded to Firebase Storage.
- The Copy Prompt button copies only the prompt text; ASCII art is not copied.
- Existing image files previously uploaded to Firebase Storage are not automatically deleted in bulk. When an old prompt is edited and converted to ASCII, its stored image URLs are removed and the old objects are best-effort deleted.


## Android PWA installation

This project includes a web app manifest, app icon, and service worker for installable PWA support. Deploy the files to Firebase Hosting over HTTPS. Open the hosted site in Chrome on Android, sign in, open the three-dot menu, and choose **Install app** or **Add to Home screen**. The PWA uses the existing Firebase project and does not migrate or delete Firestore data. Firebase operations still require an internet connection.

After updating the files, deploy Hosting only if you do not intend to change Firebase rules: `firebase deploy --only hosting`.
