"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getAllWordStatuses, getAllSentences } from "@/lib/progress";

const STATUS_TABS = [
  { key: "forgot", label: "背不起来", bg: "#F0DAD3", fg: "#8a3d2e", activeBg: "#C1665A" },
  { key: "uncertain", label: "不确定", bg: "#F4E6C9", fg: "#8a6a1f", activeBg: "#D9A63B" },
  { key: "learned", label: "学废了", bg: "#DCE6D0", fg: "#4a6338", activeBg: "#6E8B5D" },
];

function BoldedSentence({ sentence, word }) {
  if (!sentence) return null;
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return <p style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: "#2B2620" }}>{sentence}</p>;
  const before = sentence.slice(0, idx);
  const match = sentence.slice(idx, idx + word.length);
  const after = sentence.slice(idx + word.length);
  return (
    <p style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: "#2B2620" }}>
      {before}
      <strong>{match}</strong>
      {after}
    </p>
  );
}

export default function LearnedWords() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState([]); // merged status + Notion content + user sentences
  const [activeStatus, setActiveStatus] = useState("learned");
  const [activeTheme, setActiveTheme] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const [statuses, sentenceRecords] = await Promise.all([
          getAllWordStatuses(u.uid),
          getAllSentences(u.uid),
        ]);

        if (statuses.length) {
          const idsParam = statuses.map((s) => s.id).join(",");
          const res = await fetch(`/api/words?mode=byIds&ids=${encodeURIComponent(idsParam)}`);
          const data = await res.json();
          const contentById = new Map((data.words ?? []).map((w) => [w.id, w]));

          // Group sentences by wordId (falling back to matching on the word
          // text for any older records saved before wordId existed), oldest
          // first so they read in the order they were written.
          const sentencesByKey = new Map();
          sentenceRecords.forEach((s) => {
            const key = s.wordId || s.word?.toLowerCase();
            if (!key) return;
            const list = sentencesByKey.get(key) ?? [];
            list.push(s);
            sentencesByKey.set(key, list);
          });
          sentencesByKey.forEach((list) =>
            list.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
          );

          const merged = statuses
            .map((s) => {
              const content = contentById.get(s.id);
              if (!content) return null;
              const sentences =
                sentencesByKey.get(s.id) ?? sentencesByKey.get(content.word?.toLowerCase()) ?? [];
              return { ...content, status: s.status, theme: s.theme, sentences };
            })
            .filter(Boolean);
          setWords(merged);
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "#F6EFE1", color: "#8a7d63" }}>
        Loading…
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "#F6EFE1" }}>
        <p style={{ fontFamily: "'Noto Sans SC', sans-serif", color: "#6b5f48" }}>请先登录</p>
        <a href="/" style={{ color: "#A15C38" }} className="text-sm underline">
          返回首页
        </a>
      </main>
    );
  }

  const themes = Array.from(new Set(words.map((w) => w.theme))).filter(Boolean);
  const counts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab.key] = words.filter((w) => w.status === tab.key && (activeTheme === "all" || w.theme === activeTheme)).length;
    return acc;
  }, {});

  const filtered = words.filter(
    (w) => w.status === activeStatus && (activeTheme === "all" || w.theme === activeTheme)
  );

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: "#F6EFE1" }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Kalam:wght@700&family=Fraunces:wght@500;600&family=Noto+Serif+SC:wght@600&family=Noto+Sans+SC&family=Inter&display=swap"
      />
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <div style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 600, fontSize: 22, color: "#2B2620" }}>
            📚 我学过的单词
          </div>
          <a href="/" style={{ fontFamily: "Inter, sans-serif", fontSize: 13, color: "#A15C38" }}>
            ← 返回学习
          </a>
        </div>
        <p style={{ fontFamily: "'Noto Sans SC', sans-serif", fontSize: 13, color: "#8a7d63", marginBottom: 20 }}>
          按分类和状态查看你学过的单词
        </p>

        {/* Status tabs */}
        <div className="flex gap-2 mb-4">
          {STATUS_TABS.map((tab) => {
            const active = activeStatus === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveStatus(tab.key);
                  setExpandedId(null);
                }}
                style={{
                  flex: 1,
                  background: active ? tab.activeBg : tab.bg,
                  color: active ? "#FFFCF5" : tab.fg,
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 500,
                  fontSize: 13,
                  padding: "10px 0",
                  borderRadius: 10,
                  border: "none",
                }}
              >
                {tab.label} ({counts[tab.key] ?? 0})
              </button>
            );
          })}
        </div>

        {/* Theme filter */}
        {themes.length > 0 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveTheme("all")}
              style={{
                background: activeTheme === "all" ? "#2B2620" : "#EDE3CE",
                color: activeTheme === "all" ? "#FFFCF5" : "#6b5f48",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 999,
                border: "none",
                whiteSpace: "nowrap",
              }}
            >
              全部
            </button>
            {themes.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTheme(t)}
                style={{
                  background: activeTheme === t ? "#2B2620" : "#EDE3CE",
                  color: activeTheme === t ? "#FFFCF5" : "#6b5f48",
                  fontSize: 12,
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Word list */}
        {filtered.length === 0 ? (
          <div
            className="rounded-2xl p-10 text-center"
            style={{ background: "#FFFCF5", border: "1px solid #d8cdb8", color: "#8a7d63", fontSize: 14 }}
          >
            这里还没有单词
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((w) => {
              const isExpanded = expandedId === w.id;
              return (
                <div
                  key={w.id}
                  onClick={() => setExpandedId(isExpanded ? null : w.id)}
                  className="rounded-xl p-4 cursor-pointer"
                  style={{ background: "#FFFCF5", border: "1px solid #d8cdb8" }}
                >
                  <div className="flex items-center justify-between">
                    <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: "#2B2620" }}>
                      {w.word}
                    </span>
                    <span style={{ fontSize: 11, color: "#a1927a" }}>{w.theme}</span>
                  </div>

                  {!isExpanded ? (
                    <div className="mt-2">
                      <BoldedSentence sentence={w.contextSentence} word={w.word} />
                    </div>
                  ) : (
                    <div className="mt-3 text-left">
                      {w.isPastYear && (
                        <span
                          className="inline-block text-xs font-medium rounded-full px-2 py-0.5 mb-2"
                          style={{ color: "#8a3d2e", background: "#F0DAD3", border: "1px solid #e0b8ac" }}
                        >
                          {w.sourceTag || "Past Year Paper"}
                        </span>
                      )}
                      <div className="mb-2">
                        <p style={{ fontSize: 11, fontWeight: 600, color: "#8a7d63" }}>Definition:</p>
                        <p style={{ fontSize: 14, color: "#2B2620" }}>{w.definition}</p>
                      </div>
                      {w.mandarinDefinition && (
                        <div className="mb-2">
                          <p style={{ fontSize: 11, fontWeight: 600, color: "#8a7d63" }}>Mandarin definition:</p>
                          <p style={{ fontSize: 14, color: "#6b5f48" }}>{w.mandarinDefinition}</p>
                        </div>
                      )}
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "#8a7d63" }}>Example sentence:</p>
                        <p style={{ fontSize: 13, color: "#8a7d63", fontStyle: "italic" }}>&ldquo;{w.example}&rdquo;</p>
                      </div>
                      {w.examinerTip && (
                        <p style={{ fontSize: 12, color: "#8a7d63", borderTop: "1px solid #e8ddc8", paddingTop: 8, marginTop: 8 }}>
                          💡 {w.examinerTip}
                        </p>
                      )}
                      {w.sentences && w.sentences.length > 0 && (
                        <div style={{ borderTop: "1px solid #e8ddc8", paddingTop: 8, marginTop: 8 }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "#8a7d63" }} className="mb-1.5">
                            Your sentences:
                          </p>
                          <div className="flex flex-col gap-2">
                            {w.sentences.map((s) => (
                              <p key={s.id} style={{ fontFamily: "'Fraunces', serif", fontSize: 14, color: "#2B2620" }}>
                                {s.sentence}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
