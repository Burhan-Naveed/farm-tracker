// =========================================================
// Login, logout and password emails (Firebase Authentication).
// Passwords are handled and hashed by Firebase; the app never stores them.
// =========================================================

import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { auth } from "../firebase.js";

export const watchAuth = (onChange) => onAuthStateChanged(auth, onChange);
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signOutUser = () => signOut(auth);
export const sendPasswordEmail = (email) => sendPasswordResetEmail(auth, email);
