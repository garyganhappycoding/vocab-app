"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { getUserProgress, recordWordLearned, saveSentence } from "@/lib/progress";

const DAILY_GOAL = 10;
const THEMES = ["Article", "Review", "Report", "Food", "Travel", "Environment", "School", "Friends", "Others"];

function BoldedSentence({ sentence, word }) {
  if (!sentence) return null;
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return <p className="text-xl leading-relaxed text-neutral-900">{sentence}</p>;
  const before = sentence.slice(0, idx);
  const match = sentence.slice(idx, idx + word.length);
  const after = sentence.slice(idx + word.length);
  return (
    <p className="text-xl leading-relaxed text-neutral-900">
      {before}
      <strong>{match}</strong>
      {after}
    </p>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  const [stage, setStage] = useState("picker"); // picker | front | flipped | marked | sentence | congrats | empty | review-picker | review-cards
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [originalWords, setOriginalWords] = useState([]);
  const [queue, setQueue] = useState([]);
  const [lastMarked, setLastMarked] = useState(null);

  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [sentenceDraft, setSentenceDraft] = useState("");

  const [reviewTheme, setReviewTheme] = useState(null);
  const [reviewWords, setReviewWords] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewFlipped, setReviewFlipped] = useState(false);

  const [peekIndex, setPeekIndex] = useState(null); // browsing today's earlier words, read-only

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

  async function selectTheme(theme) {
    const cursor = progress?.themeCursors?.[theme] ?? 0;
    const res = await fetch(`/api/words?theme=${encodeURIComponent(theme)}&after=${cursor}&limit=${DAILY_GOAL}`);
    const data = await res.json();
    const fetched = data.words ?? [];
    setSelectedTheme(theme);
    setOriginalWords(fetched);
    setQueue(fetched);
    setPeekIndex(null);
    setStage(fetched.length ? "front" : "empty");
  }

  async function handleGotIt() {
    const word = queue[0];
    const { streak, wordsLearnedToday, themeCursors } = await recordWordLearned(user.uid, selectedTheme);
    setProgress((p) => ({ ...p, streak, wordsLearnedToday, themeCursors }));
    setQueue((q) => q.slice(1));
    setLastMarked({ word, result: "gotit" });
    setStage("marked");
  }

  function handleReviewAgain() {
    const word = queue[0];
    setQueue((q) => [...q.slice(1), q[0]]);
    setLastMarked({ word, result: "review" });
    setStage("marked");
  }

  function handleNextWord() {
    if (queue.length === 0) {
      setSentenceIndex(0);
      setStage("sentence");
    } else {
      setStage("front");
    }
  }

  async function handleSubmitSentence() {
    if (!sentenceDraft.trim()) return;
    const w = originalWords[sentenceIndex];
    await saveSentence(user.uid, { theme: selectedTheme, word: w.word, sentence: sentenceDraft.trim() });
    setSentenceDraft("");
    if (sentenceIndex + 1 >= originalWords.length) {
      setStage("congrats");
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
  }

  function handleNextPeek() {
    const livePosition = current ? originalWords.findIndex((w) => w.id === current.id) : -1;
    setPeekIndex((i) => {
      const next = (i ?? 0) + 1;
      return next >= livePosition ? null : next;
    });
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
    return <main className="min-h-screen flex items-center justify-center text-neutral-500">Loading…</main>;
  }

  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6">
        <h1 className="text-2xl font-medium text-neutral-900">10 words a day for SPM English</h1>
        <button
          onClick={() => signInWithPopup(auth, googleProvider)}
          className="border rounded-lg px-5 py-2.5 hover:bg-neutral-50 text-neutral-900"
        >
          Continue with Google
        </button>
      </main>
    );
  }

  const current = queue[0];
  const wordsLearnedToday = progress?.wordsLearnedToday ?? 0;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm bg-neutral-50 rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4 text-sm">
          <span className="text-neutral-900">Streak: {progress?.streak ?? 0} days</span>
          <button onClick={() => signOut(auth)} className="text-neutral-400 text-xs">
            Sign out
          </button>
        </div>

        {stage !== "picker" && stage !== "review-picker" && stage !== "review-cards" && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-neutral-600 mb-1.5">
              <span>{selectedTheme}</span>
              <span>{Math.min(wordsLearnedToday, DAILY_GOAL)} / {DAILY_GOAL} today</span>
            </div>
            <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-neutral-900 rounded-full transition-all"
                style={{ width: `${Math.min(wordsLearnedToday / DAILY_GOAL, 1) * 100}%` }}
              />
            </div>
          </div>
        )}

        {stage === "picker" && (
          <div>
            <p className="text-sm text-neutral-600 mb-3">Pick a theme to study today</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => selectTheme(t)}
                  className="border rounded-lg py-2.5 text-sm text-neutral-900 hover:bg-neutral-100"
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStage("review-picker")}
              className="w-full border rounded-lg py-2.5 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              📖 Review past words
            </button>
          </div>
        )}

        {stage === "review-picker" && (
          <div>
            <p className="text-sm text-neutral-600 mb-3">Review words you&apos;ve already covered</p>
            {reviewedThemes().length === 0 ? (
              <p className="text-sm text-neutral-500 mb-4">You haven&apos;t completed any words yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {reviewedThemes().map(([t, count]) => (
                  <button
                    key={t}
                    onClick={() => selectReviewTheme(t)}
                    className="border rounded-lg py-2.5 text-sm text-neutral-900 hover:bg-neutral-100"
                  >
                    {t} ({count})
                  </button>
                ))}
              </div>
            )}
            <button onClick={backToPicker} className="w-full border rounded-lg py-2 text-sm text-neutral-600">
              Back
            </button>
          </div>
        )}

        {stage === "review-cards" && reviewWords[reviewIndex] && (
          <>
            <p className="text-xs text-neutral-500 mb-2">
              {reviewTheme} — {reviewIndex + 1} / {reviewWords.length}
            </p>
            <div
              onClick={() => setReviewFlipped((f) => !f)}
              className="bg-white border rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center cursor-pointer"
            >
              {!reviewFlipped ? (
                <>
                  <BoldedSentence sentence={reviewWords[reviewIndex].contextSentence} word={reviewWords[reviewIndex].word} />
                  <p className="text-xs text-neutral-400 mt-4">tap to reveal</p>
                </>
              ) : (
                <div className="w-full text-left">
                  {reviewWords[reviewIndex].isPastYear && (
                    <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 mb-2">
                      {reviewWords[reviewIndex].sourceTag || "Past Year Paper"}
                    </span>
                  )}
                  <p className="text-xl font-medium text-neutral-900 mb-2">{reviewWords[reviewIndex].word}</p>
                  <p className="text-base text-neutral-800 mb-1">{reviewWords[reviewIndex].definition}</p>
                  {reviewWords[reviewIndex].mandarinDefinition && (
                    <p className="text-base text-neutral-600 mb-3">{reviewWords[reviewIndex].mandarinDefinition}</p>
                  )}
                  <p className="text-sm text-neutral-500 italic">&ldquo;{reviewWords[reviewIndex].example}&rdquo;</p>
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
                className="flex-1 border rounded-lg py-2 text-neutral-900 disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                onClick={() => {
                  setReviewFlipped(false);
                  setReviewIndex((i) => Math.min(reviewWords.length - 1, i + 1));
                }}
                disabled={reviewIndex === reviewWords.length - 1}
                className="flex-1 border rounded-lg py-2 text-neutral-900 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
            <button onClick={backToPicker} className="w-full border rounded-lg py-2 mt-2 text-sm text-neutral-600">
              Back to menu
            </button>
          </>
        )}

        {stage === "empty" && (
          <div className="bg-white border rounded-2xl p-10 text-center">
            <p className="text-base font-medium text-neutral-900 mb-1">No new words here yet</p>
            <p className="text-sm text-neutral-500 mb-4">Check back after more {selectedTheme} words are added.</p>
            <button onClick={backToPicker} className="border rounded-lg px-4 py-2 text-sm text-neutral-900">
              Choose another theme
            </button>
          </div>
        )}

        {(stage === "front" || stage === "flipped") && current && (
          <>
            {peekIndex !== null ? (
              <>
                <p className="text-xs text-neutral-500 mb-2">
                  Checking word {peekIndex + 1} of {originalWords.findIndex((w) => w.id === current.id) + 1}
                </p>
                <div className="bg-white border rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center">
                  <div className="w-full text-left">
                    {originalWords[peekIndex].isPastYear && (
                      <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 mb-2">
                        {originalWords[peekIndex].sourceTag || "Past Year Paper"}
                      </span>
                    )}
                    <p className="text-xl font-medium text-neutral-900 mb-2">{originalWords[peekIndex].word}</p>
                    <p className="text-base text-neutral-800 mb-1">{originalWords[peekIndex].definition}</p>
                    {originalWords[peekIndex].mandarinDefinition && (
                      <p className="text-base text-neutral-600 mb-3">{originalWords[peekIndex].mandarinDefinition}</p>
                    )}
                    <p className="text-sm text-neutral-500 italic mb-2">&ldquo;{originalWords[peekIndex].example}&rdquo;</p>
                    {originalWords[peekIndex].examinerTip && (
                      <p className="text-xs text-neutral-500 border-t pt-2 mt-2">💡 {originalWords[peekIndex].examinerTip}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handlePrevWord}
                    disabled={peekIndex === 0}
                    className="flex-1 border rounded-lg py-2 text-neutral-900 disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button onClick={handleNextPeek} className="flex-1 border rounded-lg py-2 text-neutral-900">
                    Next →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  onClick={() => stage === "front" && setStage("flipped")}
                  className={`bg-white border rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center ${stage === "front" ? "cursor-pointer" : ""}`}
                >
                  {stage === "front" && (
                    <>
                      <BoldedSentence sentence={current.contextSentence} word={current.word} />
                      <p className="text-xs text-neutral-400 mt-4">tap to reveal</p>
                    </>
                  )}
                  {stage === "flipped" && (
                    <div className="w-full text-left">
                      {current.isPastYear && (
                        <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 mb-2">
                          {current.sourceTag || "Past Year Paper"}
                        </span>
                      )}
                      <p className="text-xl font-medium text-neutral-900 mb-2">{current.word}</p>
                      <p className="text-base text-neutral-800 mb-1">{current.definition}</p>
                      {current.mandarinDefinition && (
                        <p className="text-base text-neutral-600 mb-3">{current.mandarinDefinition}</p>
                      )}
                      <p className="text-sm text-neutral-500 italic mb-2">&ldquo;{current.example}&rdquo;</p>
                      {current.examinerTip && (
                        <p className="text-xs text-neutral-500 border-t pt-2 mt-2">💡 {current.examinerTip}</p>
                      )}
                    </div>
                  )}
                </div>

                {stage === "flipped" && (
                  <div className="flex gap-3 mt-4">
                    <button onClick={handleGotIt} className="flex-1 border rounded-lg py-2 text-neutral-900">
                      Got it
                    </button>
                    <button onClick={handleReviewAgain} className="flex-1 border rounded-lg py-2 text-neutral-900">
                      Review again
                    </button>
                  </div>
                )}

                {originalWords.findIndex((w) => w.id === current.id) > 0 && (
                  <button
                    onClick={handlePrevWord}
                    className="w-full border rounded-lg py-2 mt-2 text-xs text-neutral-500"
                  >
                    ← Check previous word
                  </button>
                )}
              </>
            )}
          </>
        )}

        {stage === "marked" && lastMarked && (
          <>
            <div className="bg-white border rounded-2xl p-8 min-h-[220px] flex flex-col items-center justify-center text-center">
              <p className="text-lg font-medium text-neutral-900 mb-1">
                {lastMarked.result === "gotit" ? "✓" : "↻"} {lastMarked.word.word}
              </p>
              <p className="text-sm text-neutral-500">
                {lastMarked.result === "gotit" ? "Marked — ready for the next word" : "We'll come back to this one"}
              </p>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleNextWord} className="flex-1 border rounded-lg py-2 text-neutral-900">
                Next word →
              </button>
            </div>
          </>
        )}

        {stage === "sentence" && originalWords[sentenceIndex] && (
          <div className="bg-white border rounded-2xl p-6">
            <p className="text-xs text-neutral-500 mb-2">
              Sentence {sentenceIndex + 1} / {originalWords.length}
            </p>
            <p className="text-base text-neutral-900 mb-1 font-medium">{originalWords[sentenceIndex].word}</p>
            <p className="text-sm text-neutral-600 mb-3">
              {originalWords[sentenceIndex].sentencePrompt || `Write a sentence using "${originalWords[sentenceIndex].word}".`}
            </p>
            <textarea
              value={sentenceDraft}
              onChange={(e) => setSentenceDraft(e.target.value)}
              rows={4}
              className="w-full border rounded-lg p-3 text-sm text-neutral-900"
              placeholder="Write your sentence here..."
            />
            <button
              onClick={handleSubmitSentence}
              disabled={!sentenceDraft.trim()}
              className="mt-3 w-full border rounded-lg py-2 text-neutral-900 disabled:opacity-40"
            >
              Submit
            </button>
          </div>
        )}

        {stage === "congrats" && (
          <div className="bg-white border rounded-2xl p-10 text-center">
            <p className="text-2xl font-semibold text-neutral-900 mb-2">🎉 Congrats!</p>
            <p className="text-base text-neutral-800 mb-1">
              You&apos;ve completed {originalWords.length} words and sentences in {selectedTheme}.
            </p>
            <p className="text-sm text-neutral-500 mb-4">Come back tomorrow to keep your streak alive.</p>
            <div className="flex flex-col gap-2">
              <button onClick={backToPicker} className="border rounded-lg px-4 py-2 text-sm text-neutral-900">
                Study another theme
              </button>
              <button
                onClick={() => setStage("review-picker")}
                className="border rounded-lg px-4 py-2 text-sm text-neutral-600"
              >
                📖 Review past words
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}