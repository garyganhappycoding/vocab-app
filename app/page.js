"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import {
  getUserProgress,
  recordWordLearned,
  saveSentence,
  recordWordStatus,
  getDueReviewWordIds,
  getLearnedWordIds,
} from "@/lib/progress";

const DAILY_GOAL = 10;
const THEMES = ["Article", "Book Review", "Report", "Food", "Travel", "Environment", "School", "Friends", "Others"];
const STEPS = [
  { zh: "猜猜看这个粗体单词的意思", en: "Guess the bold word" },
  { zh: "阅读并记住这个单词", en: "Read and memorize the word" },
  { zh: "每天完成 10 个单词并造句", en: "Complete 10 words a day and make a sentence" },
];

// "Old Paperback" palette — shared across the whole app so every screen
// (landing, picker, cards, review, sentence, congrats) reads as one brand.
const C = {
  paper: "#F6EFE1",
  panel: "#EDE3CE",
  card: "#FFFCF5",
  ink: "#2B2620",
  inkSoft: "#6b5f48",
  inkFaint: "#8a7d63",
  border: "#d8cdb8",
  spine: "#A15C38",
  roseBg: "#F0DAD3",
  roseFg: "#8a3d2e",
  amberBg: "#F4E6C9",
  amberFg: "#8a6a1f",
  sageBg: "#DCE6D0",
  sageFg: "#4a6338",
};

const FONTS_LINK = (
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Kalam:wght@700&family=Fraunces:wght@500;600&family=Noto+Serif+SC:wght@600&family=Noto+Sans+SC&family=Inter&display=swap"
  />
);

function BoldedSentence({ sentence, word }) {
  if (!sentence) return null;
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: C.ink, lineHeight: 1.6 }}>{sentence}</p>;
  const before = sentence.slice(0, idx);
  const match = sentence.slice(idx, idx + word.length);
  const after = sentence.slice(idx + word.length);
  return (
    <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: C.ink, lineHeight: 1.6 }}>
      {before}
      <strong style={{ color: C.spine }}>{match}</strong>
      {after}
    </p>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  const [stage, setStage] = useState("picker"); // picker | front | flipped | marked | sentence | congrats | empty | review-picker | review-cards | daily-limit | wrap-up
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [originalWords, setOriginalWords] = useState([]);
  const [queue, setQueue] = useState([]);
  const [lastMarked, setLastMarked] = useState(null);

  // Words currently being used for the sentence stage.
  const [sentenceWords, setSentenceWords] = useState([]);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [sentenceDraft, setSentenceDraft] = useState("");
  // Where to go once the current sentence round is finished.
  const [sentenceCompletionTarget, setSentenceCompletionTarget] = useState("congrats");
  // Words marked 学废了 since the last sentence round finished — this IS the
  // sentence pool. Grows as the user marks words across the daily-goal
  // checkpoint, "keep learning" cycles, and theme switches; clears every time
  // a sentence round completes (so a word is only ever prompted for a
  // sentence once). This is what makes Exit always prompt for exactly the
  // words learned since the last round, however many that is.
  const [pendingSentenceBatch, setPendingSentenceBatch] = useState([]);

  const [reviewTheme, setReviewTheme] = useState(null);
  const [reviewWords, setReviewWords] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewFlipped, setReviewFlipped] = useState(false);

  const [peekIndex, setPeekIndex] = useState(null); // browsing today's earlier words, read-only
  const [peekFlipped, setPeekFlipped] = useState(true); // peeked words open on the definition side by default, tap to flip

 const [landingPickerOpen, setLandingPickerOpen] = useState(false); // logged-out theme picker
  const [pendingTheme, setPendingTheme] = useState(null); // theme chosen before sign-in, applied right after
  const [pastGoalConfirmed, setPastGoalConfirmed] = useState(false); // user chose to keep going past today's goal


  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const p = await getUserProgress(u.uid);
        setProgress(p);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Once sign-in completes, if the user picked a theme on the landing page
  // before logging in, jump straight into that theme's session.
  useEffect(() => {
    if (user && progress && pendingTheme) {
      selectTheme(pendingTheme);
      setPendingTheme(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, progress, pendingTheme]);

  function handleLandingThemePick(theme) {
    setPendingTheme(theme);
    signInWithPopup(auth, googleProvider);
  }

  async function selectTheme(theme) {
    const cursor = progress?.themeCursors?.[theme] ?? 0;

    const [newRes, dueStatuses, learnedIds] = await Promise.all([
      fetch(`/api/words?theme=${encodeURIComponent(theme)}&after=${cursor}&limit=${DAILY_GOAL}`).then((r) => r.json()),
      getDueReviewWordIds(user.uid, theme),
      getLearnedWordIds(user.uid, theme),
    ]);

    let dueWords = [];
    if (dueStatuses.length) {
      const idsParam = dueStatuses.map((s) => s.id).join(",");
      const dueRes = await fetch(`/api/words?mode=byIds&ids=${encodeURIComponent(idsParam)}`);
      const dueData = await dueRes.json();
      dueWords = dueData.words ?? [];
    }

    // Belt-and-suspenders: never re-serve a word already marked learned in
    // this theme, even if the cursor-based pagination would have returned it.
    const learnedIdSet = new Set(learnedIds);
    const newWords = (newRes.words ?? []).filter((w) => !learnedIdSet.has(w.id));
    const fetched = [...dueWords, ...newWords];

    setSelectedTheme(theme);
    setOriginalWords(fetched);
    setQueue(fetched);
    setPeekIndex(null);
    // wordsLearnedToday is a whole-day cumulative count, not per-theme — so
    // if today's goal was already met in an earlier theme, stay in "extra
    // study" mode here too instead of re-triggering the checkpoint after the
    // very first word of this new theme.
    setPastGoalConfirmed((progress?.wordsLearnedToday ?? 0) >= DAILY_GOAL);
    setPendingSentenceBatch([]);
    setStage(fetched.length ? "front" : "empty");
  }

  async function handleGotIt() {
    const word = queue[0];
    const { streak, wordsLearnedToday, themeCursors } = await recordWordLearned(user.uid, selectedTheme);
    await recordWordStatus(user.uid, { theme: selectedTheme, wordId: word.id, action: "learned" });
    setProgress((p) => ({ ...p, streak, wordsLearnedToday, themeCursors }));
    setQueue((q) => q.slice(1));
    setPendingSentenceBatch((b) => [...b, { ...word, theme: selectedTheme }]);
    setLastMarked({ word, result: "gotit" });
    setStage("marked");
  }

  async function handleForgot() {
    // 背不起来 — budget of 5 repeats/day (fresh day resets to 3). Requeue to the
    // back only while the word still has repeats left for today.
    const word = queue[0];
    const { exhaustedToday } = await recordWordStatus(user.uid, {
      theme: selectedTheme,
      wordId: word.id,
      action: "forgot",
    });
    setQueue((q) => {
      const rest = q.slice(1);
      return exhaustedToday ? rest : [...rest, word];
    });
    setLastMarked({ word, result: "forgot" });
    setStage("marked");
  }

  async function handleUncertain() {
    // 不确定 — budget of 3 repeats/day. Requeue sooner than a full lap while
    // repeats remain for today.
    const word = queue[0];
    const { exhaustedToday } = await recordWordStatus(user.uid, {
      theme: selectedTheme,
      wordId: word.id,
      action: "uncertain",
    });
    setQueue((q) => {
      const rest = q.slice(1);
      if (exhaustedToday) return rest;
      const insertAt = Math.min(2, rest.length);
      return [...rest.slice(0, insertAt), word, ...rest.slice(insertAt)];
    });
    setLastMarked({ word, result: "uncertain" });
    setStage("marked");
  }

  // Starts a sentence round from the current batch, then routes to
  // `completionTarget` once it's done. If the batch is empty, skips straight
  // to the target instead of showing an empty round.
  function startSentenceRound(completionTarget) {
    if (pendingSentenceBatch.length === 0) {
      setStage(completionTarget);
      return;
    }
    setSentenceWords(pendingSentenceBatch);
    setSentenceCompletionTarget(completionTarget);
    setSentenceIndex(0);
    setSentenceDraft("");
    setStage("sentence");
  }

  function handleNextWord() {
    if (wordsLearnedToday >= DAILY_GOAL && !pastGoalConfirmed) {
      startSentenceRound("daily-limit");
      return;
    }
    if (queue.length === 0) {
      startSentenceRound("congrats");
      return;
    }
    setStage("front");
  }

  function handleContinuePastGoal() {
    setPastGoalConfirmed(true);
    setStage("front");
  }

  // Exit always passes through a sentence round for whatever's in the
  // current batch — however many words that is (could be 5, could be 10).
  function handleExitSession() {
    startSentenceRound("wrap-up");
  }

  async function handleSubmitSentence() {
    if (!sentenceDraft.trim()) return;
    const w = sentenceWords[sentenceIndex];
    await saveSentence(user.uid, { theme: w.theme || selectedTheme, word: w.word, wordId: w.id, sentence: sentenceDraft.trim() });
    setSentenceDraft("");
    if (sentenceIndex + 1 >= sentenceWords.length) {
      setPendingSentenceBatch([]);
      setStage(sentenceCompletionTarget);
    } else {
      setSentenceIndex((i) => i + 1);
    }
  }

  function backToPicker() {
    setSelectedTheme(null);
    setOriginalWords([]);
    setQueue([]);
    setPeekIndex(null);
    setStage("picker");
  }

  function handlePrevWord() {
    const livePosition = current ? originalWords.findIndex((w) => w.id === current.id) : -1;
    if (peekIndex !== null) {
      setPeekIndex((i) => Math.max(0, i - 1));
    } else if (livePosition > 0) {
      setPeekIndex(livePosition - 1);
    }
    setPeekFlipped(true);
  }

  function handleNextPeek() {
    const livePosition = current ? originalWords.findIndex((w) => w.id === current.id) : -1;
    setPeekIndex((i) => {
      const next = (i ?? 0) + 1;
      return next >= livePosition ? null : next;
    });
    setPeekFlipped(true);
  }

  async function selectReviewTheme(theme) {
    const cursor = progress?.themeCursors?.[theme] ?? 0;
    if (cursor === 0) return;
    const res = await fetch(`/api/words?theme=${encodeURIComponent(theme)}&mode=review&before=${cursor}`);
    const data = await res.json();
    setReviewTheme(theme);
    setReviewWords(data.words ?? []);
    setReviewIndex(0);
    setReviewFlipped(false);
    setStage("review-cards");
  }

  function reviewedThemes() {
    return Object.entries(progress?.themeCursors ?? {}).filter(([, count]) => count > 0);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: C.paper, color: C.inkFaint }}>
        Loading…
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: C.paper }}>
        {FONTS_LINK}
        <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-2xl overflow-hidden border" style={{ borderColor: C.border }}>
          {/* Left: brand + steps */}
          <div className="p-8 md:p-10 flex flex-col justify-center" style={{ background: C.paper }}>
            <div style={{ fontFamily: "'Kalam', cursive", fontWeight: 700, fontSize: "2.25rem", color: C.spine, lineHeight: 1.1 }}>
              Gary<span style={{ color: C.ink }}>书柜</span>
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, letterSpacing: "1px", color: "#a1927a", marginTop: 4 }}>
              garybookshelf
            </div>
            <p style={{ fontFamily: "'Noto Sans SC', sans-serif", fontSize: 14, color: C.inkSoft, marginTop: 10 }}>
              帮助 SPM / 独中生 每天学 10 个单词
            </p>
            <div style={{ height: 1, background: C.border, margin: "20px 0" }} />

            {STEPS.map((s, i) => (
              <div key={i} className="flex gap-3 items-start" style={{ marginBottom: i === STEPS.length - 1 ? 24 : 16 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, color: C.spine, width: 24 }}>
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 600, fontSize: 15, color: C.ink }}>{s.zh}</div>
                  <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 2 }}>{s.en}</div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setLandingPickerOpen(true)}
              style={{ background: C.spine, color: C.card, fontFamily: "Inter, sans-serif" }}
              className="self-start rounded-lg px-5 py-2.5 text-sm font-medium"
            >
              开始学习 →
            </button>
          </div>

          {/* Right: demo card, or theme picker once 开始学习 is pressed */}
          <div className="p-8 flex items-center justify-center" style={{ background: C.panel }}>
            {!landingPickerOpen ? (
              <div className="w-full max-w-xs">
                <div className="rounded-2xl p-7 text-center relative" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                  <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: C.ink, lineHeight: 1.5 }}>
                    Transitioning away from <b style={{ color: C.spine }}>fossil fuels</b> is vital.
                  </p>
                  <p style={{ fontSize: 11, color: C.inkFaint, marginTop: 14 }}>tap to reveal</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <div style={{ flex: 1, background: C.roseBg, color: C.roseFg, fontSize: 11, textAlign: "center", padding: "8px 0", borderRadius: 8 }}>
                    背不起来
                  </div>
                  <div style={{ flex: 1, background: C.amberBg, color: C.amberFg, fontSize: 11, textAlign: "center", padding: "8px 0", borderRadius: 8 }}>
                    不确定
                  </div>
                  <div style={{ flex: 1, background: C.sageBg, color: C.sageFg, fontSize: 11, textAlign: "center", padding: "8px 0", borderRadius: 8 }}>
                    学废了
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-xs">
                <p style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 13, color: C.inkSoft, marginBottom: 10 }}>选择今天的主题</p>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleLandingThemePick(t)}
                      style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                      className="rounded-lg py-2.5 text-sm"
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button onClick={() => setLandingPickerOpen(false)} style={{ color: C.inkFaint }} className="mt-3 text-xs">
                  ← Back
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  const current = queue[0];
  const wordsLearnedToday = progress?.wordsLearnedToday ?? 0;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: C.paper }}>
      {FONTS_LINK}
      <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-2xl overflow-hidden border" style={{ borderColor: C.border }}>
        {/* Left: persistent brand + streak + nav */}
        <div className="p-8 md:p-10 flex flex-col" style={{ background: C.paper }}>
          <div style={{ fontFamily: "'Kalam', cursive", fontWeight: 700, fontSize: "2.25rem", color: C.spine, lineHeight: 1.1 }}>
            Gary<span style={{ color: C.ink }}>书柜</span>
          </div>
          <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, letterSpacing: "1px", color: "#a1927a", marginTop: 4 }}>
            garybookshelf
          </div>
          <p style={{ fontFamily: "'Noto Sans SC', sans-serif", fontSize: 14, color: C.inkSoft, marginTop: 10 }}>
            帮助 SPM / 独中生 每天学 10 个单词
          </p>
          <div style={{ height: 1, background: C.border, margin: "20px 0" }} />

          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-3 items-start" style={{ marginBottom: i === STEPS.length - 1 ? 24 : 16 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, color: C.spine, width: 24 }}>
                {i + 1}
              </div>
              <div>
                <div style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 600, fontSize: 15, color: C.ink }}>{s.zh}</div>
                <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 2 }}>{s.en}</div>
              </div>
            </div>
          ))}

          <div style={{ fontFamily: "Inter, sans-serif", fontSize: 14, color: C.ink }}>
            Streak: {progress?.streak ?? 0} days
          </div>
          <div className="mt-auto flex flex-col gap-2 pt-8">
            <button onClick={() => signOut(auth)} style={{ color: C.inkFaint }} className="text-xs self-start">
              Sign out
            </button>
          </div>
        </div>

        {/* Right: stage-dependent active content */}
        <div className="p-8" style={{ background: C.panel }}>
        {stage !== "picker" && stage !== "review-picker" && stage !== "review-cards" && (
          <div className="mb-5">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: C.inkSoft }}>
              <span>{selectedTheme}</span>
              <span>
                {wordsLearnedToday > DAILY_GOAL ? wordsLearnedToday : Math.min(wordsLearnedToday, DAILY_GOAL)} / {DAILY_GOAL} today
                {wordsLearnedToday > DAILY_GOAL ? " 🔥" : ""}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(wordsLearnedToday / DAILY_GOAL, 1) * 100}%`, background: C.spine }}
              />
            </div>
          </div>
        )}

        {stage === "picker" && (
          <div>
            <p style={{ fontFamily: "'Noto Sans SC', sans-serif", fontSize: 14, color: C.inkSoft }} className="mb-3">
              选择今天的主题
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => selectTheme(t)}
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                  className="rounded-lg py-2.5 text-sm"
                >
                  {t}
                </button>
              ))}
            </div>
            
             <a href="/learned"
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.inkSoft }}
              className="block w-full rounded-lg py-2.5 text-sm text-center"
            >
              📚 我学过的单词
            </a>
          </div>
        )}

        {stage === "review-picker" && (
          <div>
            <p style={{ fontFamily: "'Noto Sans SC', sans-serif", fontSize: 14, color: C.inkSoft }} className="mb-3">
              Review words you&apos;ve already covered
            </p>
            {reviewedThemes().length === 0 ? (
              <p style={{ color: C.inkFaint, fontSize: 14 }} className="mb-4">
                You haven&apos;t completed any words yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {reviewedThemes().map(([t, count]) => (
                  <button
                    key={t}
                    onClick={() => selectReviewTheme(t)}
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                    className="rounded-lg py-2.5 text-sm"
                  >
                    {t} ({count})
                  </button>
                ))}
              </div>
            )}
            <button onClick={backToPicker} style={{ color: C.inkSoft }} className="w-full rounded-lg py-2 text-sm">
              Back
            </button>
          </div>
        )}

        {stage === "review-cards" && reviewWords[reviewIndex] && (
          <>
            <p style={{ fontSize: 12, color: C.inkFaint }} className="mb-2">
              {reviewTheme} — {reviewIndex + 1} / {reviewWords.length}
            </p>
            <div
              onClick={() => setReviewFlipped((f) => !f)}
              className="rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center cursor-pointer"
              style={{ background: C.card, border: `1px solid ${C.border}` }}
            >
              {!reviewFlipped ? (
                <>
                  <BoldedSentence sentence={reviewWords[reviewIndex].contextSentence} word={reviewWords[reviewIndex].word} />
                  <p style={{ fontSize: 11, color: C.inkFaint, marginTop: 16 }}>tap to reveal</p>
                </>
              ) : (
                <div className="w-full text-left">
                  {reviewWords[reviewIndex].isPastYear && (
                    <span
                      className="inline-block text-xs font-medium rounded-full px-2 py-0.5 mb-2"
                      style={{ color: C.roseFg, background: C.roseBg, border: `1px solid ${C.border}` }}
                    >
                      {reviewWords[reviewIndex].sourceTag || "Past Year Paper"}
                    </span>
                  )}
                  <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, color: C.ink }} className="mb-2">
                    {reviewWords[reviewIndex].word}
                  </p>
                  <p style={{ fontSize: 15, color: C.ink }} className="mb-1">
                    {reviewWords[reviewIndex].definition}
                  </p>
                  {reviewWords[reviewIndex].mandarinDefinition && (
                    <p style={{ fontSize: 15, color: C.inkSoft }} className="mb-3">
                      {reviewWords[reviewIndex].mandarinDefinition}
                    </p>
                  )}
                  <p style={{ fontSize: 13, color: C.inkFaint, fontStyle: "italic" }}>
                    &ldquo;{reviewWords[reviewIndex].example}&rdquo;
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setReviewFlipped(false);
                  setReviewIndex((i) => Math.max(0, i - 1));
                }}
                disabled={reviewIndex === 0}
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                className="flex-1 rounded-lg py-2 disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                onClick={() => {
                  setReviewFlipped(false);
                  setReviewIndex((i) => Math.min(reviewWords.length - 1, i + 1));
                }}
                disabled={reviewIndex === reviewWords.length - 1}
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                className="flex-1 rounded-lg py-2 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
            <button onClick={backToPicker} style={{ color: C.inkSoft }} className="w-full rounded-lg py-2 mt-2 text-sm">
              Back to menu
            </button>
          </>
        )}

        {stage === "empty" && (
          <div className="rounded-2xl p-10 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: C.ink }} className="mb-1">
              No new words here yet
            </p>
            <p style={{ fontSize: 13, color: C.inkFaint }} className="mb-4">
              Check back after more {selectedTheme} words are added.
            </p>
            <button
              onClick={backToPicker}
              style={{ background: C.spine, color: C.card }}
              className="rounded-lg px-4 py-2 text-sm"
            >
              Choose another theme
            </button>
          </div>
        )}

        {(stage === "front" || stage === "flipped") && current && (() => {
          const livePosition = originalWords.findIndex((w) => w.id === current.id);
          const isPeeking = peekIndex !== null;
          const displayWord = isPeeking ? originalWords[peekIndex] : current;
          const showFront = isPeeking ? !peekFlipped : stage === "front";

          function handleCardTap() {
            if (isPeeking) {
              setPeekFlipped((f) => !f);
            } else {
              setStage((s) => (s === "front" ? "flipped" : "front"));
            }
          }

          return (
            <>
              {isPeeking && (
                <p style={{ fontSize: 12, color: C.inkFaint }} className="mb-2">
                  Checking word {peekIndex + 1} of {livePosition + 1}
                </p>
              )}

              <div
                onClick={handleCardTap}
                className="rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center cursor-pointer"
                style={{ background: C.card, border: `1px solid ${C.border}` }}
              >
                {showFront ? (
                  <>
                    <p style={{ fontFamily: "'Noto Sans SC', sans-serif", fontSize: 14, color: C.inkSoft }} className="mb-3">
                      请猜猜这个词的中文意思
                    </p>
                    <BoldedSentence sentence={displayWord.contextSentence} word={displayWord.word} />
                    <p style={{ fontSize: 11, color: C.inkFaint, marginTop: 16 }}>tap to reveal</p>
                  </>
                ) : (
                  <div className="w-full text-left">
                    {displayWord.isPastYear && (
                      <span
                        className="inline-block text-xs font-medium rounded-full px-2 py-0.5 mb-2"
                        style={{ color: C.roseFg, background: C.roseBg, border: `1px solid ${C.border}` }}
                      >
                        {displayWord.sourceTag || "Past Year Paper"}
                      </span>
                    )}
                    <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, color: C.ink }} className="mb-3">
                      {displayWord.word}
                    </p>

                    <div className="mb-3">
                      <p style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }} className="mb-1">
                        Definition:
                      </p>
                      <p style={{ fontSize: 15, color: C.ink }}>{displayWord.definition}</p>
                    </div>

                    {displayWord.mandarinDefinition && (
                      <div className="mb-3">
                        <p style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }} className="mb-1">
                          Mandarin definition:
                        </p>
                        <p style={{ fontSize: 15, color: C.inkSoft }}>{displayWord.mandarinDefinition}</p>
                      </div>
                    )}

                    <div className="mb-2">
                      <p style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }} className="mb-1">
                        Example sentence:
                      </p>
                      <p style={{ fontSize: 13, color: C.inkFaint, fontStyle: "italic" }}>&ldquo;{displayWord.example}&rdquo;</p>
                    </div>

                    {displayWord.examinerTip && (
                      <p style={{ fontSize: 12, color: C.inkFaint, borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 }}>
                        💡 {displayWord.examinerTip}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handlePrevWord}
                  disabled={!isPeeking && livePosition === 0}
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                  className="flex-1 rounded-lg py-2 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={handleNextPeek}
                  disabled={!isPeeking}
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink }}
                  className="flex-1 rounded-lg py-2 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>

              {!isPeeking && (
                <button
                  onClick={handleExitSession}
                  disabled={wordsLearnedToday < DAILY_GOAL}
                  style={{ color: wordsLearnedToday < DAILY_GOAL ? "#c4b8a0" : C.inkFaint }}
                  className="w-full text-center text-xs mt-3 disabled:cursor-not-allowed"
                >
                  Exit for today
                </button>
              )}

              {stage === "flipped" && !isPeeking && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleForgot}
                    style={{ background: C.roseBg, color: C.roseFg }}
                    className="flex-1 rounded-lg py-2 text-sm font-medium"
                  >
                    背不起来
                  </button>
                  <button
                    onClick={handleUncertain}
                    style={{ background: C.amberBg, color: C.amberFg }}
                    className="flex-1 rounded-lg py-2 text-sm font-medium"
                  >
                    不确定
                  </button>
                  <button
                    onClick={handleGotIt}
                    style={{ background: C.sageBg, color: C.sageFg }}
                    className="flex-1 rounded-lg py-2 text-sm font-medium"
                  >
                    学废了
                  </button>
                </div>
              )}
            </>
          );
        })()}

        {stage === "marked" && lastMarked && (
          <>
            <div
              className="rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center"
              style={{ background: C.card, border: `1px solid ${C.border}` }}
            >
              <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, color: C.ink }} className="mb-1">
                {lastMarked.result === "gotit" ? "✓" : lastMarked.result === "uncertain" ? "🤔" : "↻"} {lastMarked.word.word}
              </p>
              <p style={{ fontSize: 13, color: C.inkFaint }}>
                {lastMarked.result === "gotit"
                  ? "学废了 — moving on"
                  : lastMarked.result === "uncertain"
                  ? "不确定 — we'll bring this back soon"
                  : "背不起来 — we'll come back to this one"}
              </p>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleNextWord}
                style={{ background: C.spine, color: C.card }}
                className="flex-1 rounded-lg py-2 text-sm font-medium"
              >
                Next word →
              </button>
            </div>
          </>
        )}

        {stage === "daily-limit" && (
          <div className="rounded-2xl p-8 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, color: C.ink }} className="mb-2">
              🎯 You&apos;ve hit today&apos;s goal!
            </p>
            <p style={{ fontSize: 13, color: C.inkFaint }} className="mb-4">
              You&apos;ve learned {wordsLearnedToday} words today. Keep going, or wrap up here?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExitSession}
                style={{ background: C.spine, color: C.card }}
                className="flex-1 rounded-lg py-2 text-sm font-medium"
              >
                I&apos;m done for today
              </button>
              <button
                onClick={handleContinuePastGoal}
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.inkSoft }}
                className="flex-1 rounded-lg py-2 text-sm font-medium"
              >
                Keep learning
              </button>
            </div>
          </div>
        )}

        {stage === "wrap-up" && (
          <div className="rounded-2xl p-10 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 24, color: C.ink }} className="mb-2">
              🎉 Nice work!
            </p>
            <p style={{ fontSize: 15, color: C.ink }} className="mb-1">
              You&apos;ve learned {wordsLearnedToday} words today.
            </p>
            <p style={{ fontSize: 13, color: C.inkFaint }} className="mb-4">
              Come back tomorrow to keep your streak alive.
            </p>
            <button
              onClick={backToPicker}
              style={{ background: C.spine, color: C.card }}
              className="rounded-lg px-4 py-2 text-sm"
            >
              Study another theme
            </button>
          </div>
        )}

        {stage === "sentence" && sentenceWords[sentenceIndex] && (
          <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 12, color: C.inkFaint }} className="mb-2">
              Sentence {sentenceIndex + 1} / {sentenceWords.length}
            </p>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: C.ink }} className="mb-1">
              {sentenceWords[sentenceIndex].word}
            </p>
            <p style={{ fontSize: 13, color: C.inkSoft }} className="mb-3">
              {sentenceWords[sentenceIndex].sentencePrompt || `Write a sentence using "${sentenceWords[sentenceIndex].word}".`}
            </p>
            <textarea
              value={sentenceDraft}
              onChange={(e) => setSentenceDraft(e.target.value)}
              rows={4}
              style={{ background: C.paper, border: `1px solid ${C.border}`, color: C.ink }}
              className="w-full rounded-lg p-3 text-sm"
              placeholder="Write your sentence here..."
            />
            <button
              onClick={handleSubmitSentence}
              disabled={!sentenceDraft.trim()}
              style={{ background: C.spine, color: C.card }}
              className="mt-3 w-full rounded-lg py-2 disabled:opacity-40"
            >
              Submit
            </button>
          </div>
        )}

        {stage === "congrats" && (
          <div className="rounded-2xl p-10 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 24, color: C.ink }} className="mb-2">
              🎉 Congrats!
            </p>
            <p style={{ fontSize: 15, color: C.ink }} className="mb-1">
              You&apos;ve completed {sentenceWords.length} words and sentences in {selectedTheme}.
            </p>
            <p style={{ fontSize: 13, color: C.inkFaint }} className="mb-4">
              Come back tomorrow to keep your streak alive.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={backToPicker}
                style={{ background: C.spine, color: C.card }}
                className="rounded-lg px-4 py-2 text-sm"
              >
                Study another theme
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </main>
  );
}
