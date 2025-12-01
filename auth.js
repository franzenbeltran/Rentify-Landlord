// Firebase Configuration
// Get your config from Firebase Console > Project Settings > Your apps

const firebaseConfig = {
  apiKey: "AIzaSyDA-i4tv81hS-q1cy75jg0Fvx7bqNNug3g",
  authDomain: "rentify-ece0c.firebaseapp.com",
  projectId: "rentify-ece0c",
  // The storage bucket should be the appspot.com bucket name
  storageBucket: "rentify-ece0c.appspot.com",
  messagingSenderId: "335061856522",
  appId: "1:335061856522:web:7c088eee12aa742ec80af3",
  measurementId: "G-3ELYYSV84G"
};

// Initialize Firebase
let app, auth, db;
document.addEventListener('DOMContentLoaded', () => {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded.');
    return;
  }

  if (!firebase.apps.length) {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
  } else {
    app = firebase.app();
    auth = firebase.auth();
    db = firebase.firestore();
  }

  // --- LOGIN ---
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = document.getElementById("loginEmail").value;
      const password = document.getElementById("loginPassword").value;

      if (loginError) loginError.innerText = "";

      try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // Save UID and email in localStorage
        localStorage.setItem("landlordToken", user.uid);
        localStorage.setItem("landlordEmail", user.email);

        // Fetch name from Firestore if exists
        const userDoc = await db.collection('landlords').doc(user.uid).get();
        const name = userDoc.exists ? userDoc.data().name : user.email;
        localStorage.setItem("landlordName", name);

        window.location.href = "index.html";
      } catch (err) {
        let errorMessage = "Login failed";
        if (err.code === "auth/user-not-found") errorMessage = "No account found with this email";
        else if (err.code === "auth/wrong-password") errorMessage = "Incorrect password";
        else if (err.code === "auth/invalid-email") errorMessage = "Invalid email address";
        else if (err.message) errorMessage = err.message;
        if (loginError) loginError.innerText = errorMessage;
      }
    });
  }

  // --- SIGNUP ---
  const signupForm = document.getElementById("signupForm");
  const signupError = document.getElementById("signupError");

  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("signupName").value;
      const email = document.getElementById("signupEmail").value;
      const password = document.getElementById("signupPassword").value;

      if (signupError) signupError.innerText = "";

      try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // Save profile to Firestore
        await db.collection('landlords').doc(user.uid).set({
          name: name,
          email: email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Save UID and name locally
        localStorage.setItem("landlordToken", user.uid);
        localStorage.setItem("landlordName", name);
        localStorage.setItem("landlordEmail", email);

        window.location.href = "index.html";
      } catch (err) {
        let errorMessage = "Signup failed";
        if (err.code === "auth/email-already-in-use") errorMessage = "An account with this email already exists";
        else if (err.code === "auth/invalid-email") errorMessage = "Invalid email address";
        else if (err.code === "auth/weak-password") errorMessage = "Password should be at least 6 characters";
        else if (err.message) errorMessage = err.message;
        if (signupError) signupError.innerText = errorMessage;
      }
    });
  }
});
