import React, { useEffect, useLayoutEffect, useRef, useState, Fragment } from "react";

const statusInit = {
  求職者ID: "未入力",
  職種: "未入力",
  現職: "未入力",
  転職目的: "未入力",
  Must: "0件",
  Want: "0件",
  Can: "未入力",
  Will: "未入力",
};

export default function Home() {
  // ← 最初は空配列でOK（ここは触らない）
const [messages, setMessages] = useState([]);
const [status, setStatus] = useState(statusInit);
const [input, setInput] = useState("");
const [sending, setSending] = useState(false);
const [sessionId] = useState(() => Math.random().toString(36).slice(2));
const [step, setStep] = useState(0);
const [isComposing, setIsComposing] = useState(false);

const listRef = useRef(null);
const taRef = useRef(null);
const bottomRef = useRef(null);

  // 進捗バー
  const MAX_STEP = 9;
  const progress = Math.min(100, Math.max(0, Math.round((step / MAX_STEP) * 100)));

  // ★最初の挨拶をサーバーから1回だけ取得
  useEffect(() => {
  let aborted = false;
  (async () => {
    try {
      const res = await fetch(`/api/chat?sessionId=${sessionId}`, { method: "GET" });
      const data = await res.json();
      if (aborted) return;

      setMessages([{ type: "ai", content: data.response }]);
      if (data.meta) {
        setStep(data.meta.step ?? 0);
        setStatus(data.meta.statusBar ?? statusInit);
      }
    } catch (e) {
      setMessages([{ type: "ai", content: "初期メッセージの取得に失敗したよ🙏" }]);
    }
  })();
  return () => { aborted = true; };
}, [sessionId]);
  
  // 最下部へスクロール（レイアウト確定後に実行）
useLayoutEffect(() => {
  const el = bottomRef.current;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "end" });
}, [messages.length, step]);
  // 送信処理
  async function onSend() {
    if (!input.trim() || sending) return;
    setSending(true);

    // ユーザー入力を即時反映
    setMessages((m) => [...m, { type: "user", content: input }]);
    const userText = input;
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, sessionId }),
      });
      const data = await res.json();

      // AI応答
      setMessages((m) => [...m, { type: "ai", content: data.response }]);

      // ステータス・ステップ更新（meta.statusBar を使う）
if (data.meta?.statusBar) setStatus(data.meta.statusBar);
if (data.meta?.step != null) setStep(data.meta.step);
    } catch (err) {
      console.error(err);
      setMessages((m) => [
        ...m,
        { type: "ai", content: "通信エラーが発生したよ🙏" },
      ]);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !isComposing && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  function statusStepLabel(step) {
    const map = {
      0: "基本情報",
      1: "求職者ID",
      2: "職種",
      3: "現在の職場",
      4: "転職理由",
      5: "絶対条件",
      6: "希望条件",
      7: "これまで（Can）",
      8: "これから（Will）",
      9: "完了",
    };
    return map[step] ?? "";
  }

  return (
  <div className="container">

    {/* ヘッダ */}
    <header className="header">
      <div className="title">
        <div>AIキャリアエージェント</div>
        <div>ほーぷちゃん</div>
      </div>
      <div className="step">
        Step {step}/{MAX_STEP}　{statusStepLabel(step)}
      </div>
    </header>

    {/* ステータスバッジ */}
    <div className="status-row">
      {[
        "求職者ID",
        "職種",
        "現職",
        "転職目的",
        "Must",
        "Want",
        "Can",
        "Will",
      ].map((k) => (
        <span key={k} className="badge">
          {k}：{status[k] ?? ""}
        </span>
      ))}
    </div>

    {/* ステータス進捗バー */}
    <div className="status-progress">
      <div
        className="status-progress__inner"
        style={{ width: `${progress}%` }}
      />
    </div>

    {/* チャット画面 */}
    <main className="chat" ref={listRef}>
      {messages.map((m, i) => (
        <div key={i} className={`msg ${m.type}`}>
          {m.type === "ai" ? (
            <>
             <div className="avatar ai">
  <img src="/hoap-icon.jpg" alt="ほーぷちゃん" />
</div>
<div className="bubble">{m.content}</div>
            </>
          ) : (
            <>
              <div className="bubble">{m.content}</div>
              <div className="avatar user">👤</div>
            </>
          )}
        </div>
      ))}
<div ref={bottomRef} />
    </main>

    {/* 入力欄 */}
    <footer className="input-bar">
      <div className="input-inner">
        <textarea
          ref={taRef}
          className="textarea"
          placeholder={
  step === 1
    ? "求職者IDを入力してください（メールに届いているID）…"
    : "メッセージを入力…"
}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onBlur={() => setIsComposing(false)}
          autoComplete="off"
        />
        <button
          type="button"
          className="send"
          onClick={onSend}
          disabled={sending}
        >
          ➤
        </button>
      </div>
    </footer>
  </div>
);
}
