import {
  doc,
  getDoc,
  setDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const todayKey = () => new Date().toISOString().slice(0, 10);
const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const DEFAULT_PROGRESS = {
  streak: 0,
  lastLearnedDate: null,
  wordsLearnedToday: 0,
  themeCursors: {},
};

export async function getUserProgress(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, DEFAULT_PROGRESS);
    return DEFAULT_PROGRESS;
  }
  return { ...DEFAULT_PROGRESS, ...snap.data() };
}

// Call this once per word the user marks "Got it" in a given theme.
export async function recordWordLearned(uid, theme) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const data = { ...DEFAULT_PROGRESS, ...(snap.data() ?? {}) };
  const today = todayKey();

  let streak = data.streak;
  let wordsLearnedToday = data.wordsLearnedToday;

  if (data.lastLearnedDate === today) {
    wordsLearnedToday += 1;
  } else if (data.lastLearnedDate === yesterdayKey()) {
    streak += 1;
    wordsLearnedToday = 1;
  } else {
    streak = 1;
    wordsLearnedToday = 1;
  }

  const nextCursor = (data.themeCursors[theme] ?? 0) + 1;
  const themeCursors = { ...data.themeCursors, [theme]: nextCursor };

  await setDoc(
    ref,
    { streak, wordsLearnedToday, lastLearnedDate: today, themeCursors, updatedAt: serverTimestamp() },
    { merge: true }
  );

  return { streak, wordsLearnedToday, themeCursors };
}

// Saves one user-written sentence, no grading.
export async function saveSentence(uid, { theme, word, sentence }) {
  const ref = doc(collection(db, "users", uid, "sentences"));
  await setDoc(ref, { theme, word, sentence, createdAt: serverTimestamp() });
}