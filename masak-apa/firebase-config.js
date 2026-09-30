/* Firebase project config for Masak Apa.
   These values are PUBLIC identifiers (not secrets) — safe to commit and ship.
   Real protection comes from the Realtime Database security rules (see README).

   ADMIN_UIDS: the Google-account UID(s) allowed to approve community suggestions.
   Filled in after the first admin Google sign-in (Authentication → Users → copy UID).
   Until at least one UID is here, the admin approve view stays locked. */
window.MASAK_FIREBASE = {
  config: {
    apiKey: "AIzaSyDez01F8iC7iZJSPVNkzJQAFuRoDMNKaH4",
    authDomain: "masak-apa-78c98.firebaseapp.com",
    databaseURL: "https://masak-apa-78c98-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "masak-apa-78c98",
    storageBucket: "masak-apa-78c98.firebasestorage.app",
    messagingSenderId: "67408126348",
    appId: "1:67408126348:web:a742c5ba335fbc16b1f6a9"
  },
  // Add your admin UID string here after first sign-in, e.g. ["abc123..."]
  ADMIN_UIDS: ["rk0p9orJk0Zce3gO07nmYct2uYn2"]
};
