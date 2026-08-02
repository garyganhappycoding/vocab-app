import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
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

// Saves one user-written sentence, no grading. wordId links it back to the
// specific word card on the "words I've learned" page (falls back to
// matching on word text for any older records saved before wordId existed).
export async function saveSentence(uid, { theme, word, wordId, sentence }) {
  const ref = doc(collection(db, "users", uid, "sentences"));
  await setDoc(ref, { theme, word, wordId: wordId ?? null, sentence, createdAt: serverTimestamp() });
}

// All sentences the user has ever submitted, across every theme and session.
// Used by the "words I've learned" page to show past sentences under each
// word card.
export async function getAllSentences(uid) {
  const colRef = collection(db, "users", uid, "sentences");
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Call whenever the user taps 学废了 / 背不起来 / 不确定 on a word.
// action: "learned" | "uncertain" | "forgot"
// Returns { status, repeatsLeft, exhaustedToday } so the caller knows
// whether to keep requeuing the word in today's session.
export async function recordWordStatus(uid, { theme, wordId, action }) {
  const ref = doc(db, "users", uid, "wordStatus", wordId);
  const today = todayKey();

  if (action === "learned") {
    await setDoc(
      ref,
      { theme, status: "learned", repeatsLeft: 0, lastActiveDate: today, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return { status: "learned", repeatsLeft: 0, exhaustedToday: true };
  }

  const snap = await getDoc(ref);
  let repeatsLeft;

  if (!snap.exists() || snap.data().status === "learned") {
    // Brand new mark (or re-marking a word that was previously mastered).
    repeatsLeft = action === "uncertain" ? 3 : 5;
  } else {
    const prev = snap.data();
    repeatsLeft = prev.lastActiveDate !== today ? 3 : prev.repeatsLeft;
  }

  repeatsLeft = Math.max(0, repeatsLeft - 1);
  const exhaustedToday = repeatsLeft === 0;

  await setDoc(
    ref,
    { theme, status: action, repeatsLeft, lastActiveDate: today, updatedAt: serverTimestamp() },
    { merge: true }
  );

  return { status: action, repeatsLeft, exhaustedToday };
}

// Words in this theme still marked uncertain/forgot (not yet mastered),
// whose repeat budget for today hasn't been fully used up.
// Call this when starting a theme session to know which words to requeue.
export async function getDueReviewWordIds(uid, theme) {
  const today = todayKey();
  const colRef = collection(db, "users", uid, "wordStatus");
  const q = query(colRef, where("theme", "==", theme), where("status", "in", ["uncertain", "forgot"]));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((w) => w.lastActiveDate !== today || w.repeatsLeft > 0);
}

// WordIds already marked fully learned (学废了) in this theme. Used as a
// belt-and-suspenders guard on the "new words" fetch — the theme cursor is
// supposed to make sure a word already learned never gets re-served, but the
// cursor can drift (e.g. a due-review completion also advances it), so this
// gives a direct, explicit exclusion regardless of what the cursor thinks.
export async function getLearnedWordIds(uid, theme) {
  const colRef = collection(db, "users", uid, "wordStatus");
  const q = query(colRef, where("theme", "==", theme), where("status", "==", "learned"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

// All non-learned-only status records across every theme, for the
// "words I've learned" page. Returns everything (learned + uncertain + forgot)
// so the page can group and filter client-side.
export async function getAllWordStatuses(uid) {
  const colRef = collection(db, "users", uid, "wordStatus");
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
