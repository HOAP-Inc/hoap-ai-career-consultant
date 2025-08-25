// pages/index.js
import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";

const steps = [
  { key: "basic", label: "基本情報" },
  { key: "reason", label: "転職理由" },
  { key: "must", label: "Must" },
  { key: "want", label: "Want" },
  { key: "can", label: "Can" },
  { key: "will", label: "Will" },
];

function Avatar({ who }) {
  // who: 'ai' | 'user'
  return (
    <div
      className={`h-9 w-9 flex items-center justify-center rounded-full shadow border border-white/70 ${
        who === "ai"
          ? "bg-gradient-to-br from-pink-100 to-violet-100"
          : "bg-gradient-to-br from-sky-100 to-indigo-100"
      }`}
      aria-hidden
    >
      <span className="text-xl">{who === "ai" ? "🤖" : "🧑"}</span>
    </div>
  );
}

function Bubble({ who, children }) {
  const base =
    "max-w-[680px] card px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap";
  return (
    <div className={`flex ${who === "user" ? "justify-end" : "justify-start"} w-full`}>
      <div className={`flex items-start gap-3 ${who === "user" ? "flex-row-reverse" : ""}`}>
        <Avatar who={who} />
        <div className={`${base} ${who === "user" ? "bg-white" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

export default function Home() {
  // 表示用ステータス
  const [status, setStatus] = useState({
    number: "未入力",
    job: "未入力",
    place: "未入力",
    reason: "未入力",
    mustCount: 0,
    wantCount: 0,
    can: "未入力",
    will: "未入力",
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));

  const listRef = useRef(null);

  const [messages, setMessages] = useState(() => [
    {
      who: "ai",
      text:
        "こんにちは！\n担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。\n\n最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！",
    },
  ]);

  useEffect(() => {
    // 最新メッセージまでスクロール
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const stepLabel = useMemo(() => steps[currentStep]?.label ?? "-", [currentStep]);

  // 送信
  const onSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    // ユーザーメッセージ表示
    setMessages((m) => [...m, { who: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages.map(({ who, text }) => ({
            type: who === "ai" ? "ai" : "user",
            content: text,
          })),
          currentStep,
          sessionId,
          status,
        }),
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();

      // 表示
      if (data?.response) {
        setMessages((m) => [...m, { who: "ai", text: data.response }]);
      }

      // ステップ遷移
      if (typeof data?.step === "number") setCurrentStep(data.step);

      // ステータス更新（あれば）
      setStatus((prev) => ({
        ...prev,
        ...(data?.statusUpdates ?? {}),
      }));
    } catch (e) {
      setMessages((m) => [
        ...m,
        { who: "ai", text: "すみません、通信でエラーが出ました。もう一度お願いします。" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const progress = Math.min(((currentStep + 1) / steps.length) * 100, 100);

  return (
    <>
      <Head>
        <title>ほーぷちゃん</title>
      </Head>

      <div className="min-h-screen">
        {/* ヘッダ */}
        <header className="sticky top-0 z-10 bg-white/70 backdrop-blur border-b border-white/70">
          <div className="mx-auto max-w-5xl px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-[28px] font-bold gradient-text">ほーぷちゃん</h1>
              <div className="text-sm text-[color:var(--hoap-sub)]">
                Step {currentStep + 1}/6
                <span className="ml-2 font-medium text-[color:var(--hoap-fg)]">{stepLabel}</span>
              </div>
            </div>

            {/* ステータスバー */}
            <div className="mt-3 flex flex-wrap gap-8 text-sm">
              <div className="flex items-center gap-2">
                <span className="badge">番号：</span>
                <span>{status.number}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">職種：</span>
                <span>{status.job}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">勤務地：</span>
                <span>{status.place}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">転職理由：</span>
                <span>{status.reason}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">Must：</span>
                <span>{status.mustCount}件</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">Want：</span>
                <span>{status.wantCount}件</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">Can：</span>
                <span>{status.can}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">Will：</span>
                <span>{status.will}</span>
              </div>
            </div>

            {/* 進捗バー */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-gradient-to-r from-pink-100 via-violet-100 to-sky-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg,var(--hoap-grad-a),var(--hoap-grad-b),var(--hoap-grad-c))",
                  width: `${progress}%`,
                  boxShadow: "0 0 12px rgba(167,139,250,.5)",
                }}
              />
            </div>
          </div>
        </header>

        {/* メイン */}
        <main className="mx-auto max-w-5xl px-5 pb-36 pt-6">
          <div ref={listRef} className="flex flex-col gap-5 chat-scroll">
            {messages.map((m, i) => (
              <Bubble key={i} who={m.who}>
                {m.text}
              </Bubble>
            ))}

            {loading && (
              <Bubble who="ai">
                <span className="opacity-70">・・・考え中</span>
              </Bubble>
            )}
          </div>
        </main>

        {/* フッター入力 */}
        <footer className="fixed bottom-0 left-0 right-0 bg-white/70 backdrop-blur border-t border-white/70">
          <div className="mx-auto max-w-5xl px-5 py-4">
            <div className="flex items-end gap-3">
              <textarea
                className="input min-h-[52px] max-h-36 resize-none"
                placeholder={
                  currentStep === 0
                    ? "求職者IDを入力してください（メールに届いているID）…"
                    : "メッセージを入力…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
              />
              <button onClick={onSend} className="btn" aria-label="送信">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22,2 15,22 11,13 2,9" />
                </svg>
              </button>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
