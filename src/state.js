// =========================================================
// App state, kept in memory and updated live from Firestore.
// =========================================================

import { headsById } from "./domain/heads.js";

export const state = {
  user: null,           // Firebase Auth user
  profile: null,        // matching document from the "users" collection
  heads: [],            // all heads (active and inactive)
  headMap: new Map(),   // head id -> head, for fast lookups
  expenses: [],         // all entries, newest first
  users: []             // all users (Admin only)
};

export const isAdmin = () => !!state.profile && state.profile.role === "admin";

/** Who is making a change (saved with records and in the audit log). */
export const currentActor = () => ({ uid: state.user.uid, email: state.user.email });

export function setHeads(heads) {
  state.heads = heads;
  state.headMap = headsById(heads);
}

/** Clears all loaded data (on logout or when access is removed). */
export function clearData() {
  state.profile = null;
  state.expenses = [];
  state.users = [];
  setHeads([]);
}
