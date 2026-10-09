import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyB4T1Z_HTsJuXagehxzSkwb5iLyHiT9w78",
  authDomain: "prompt-save-6f510.firebaseapp.com",
  projectId: "prompt-save-6f510",
  storageBucket: "prompt-save-6f510.firebasestorage.app",
  messagingSenderId: "147158100027",
  appId: "1:147158100027:web:d799ab884ffa45ed1ad41e",
  measurementId: "G-45P1JZBFBZ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export { setPersistence, browserLocalPersistence, browserSessionPersistence };

isSupported().then(ok => {
  if (ok) getAnalytics(app);
}).catch(() => {});
