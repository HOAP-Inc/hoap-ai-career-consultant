// pages/index.js
import React, { useEffect, useRef, useState, Fragment } from "react";

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

const firstAI =
  "こんにちは！私はAIキャリアエージェント『ほーぷちゃん』です🤖✨\n" +
  "担当との面談の前に、あなたの希望条件や想いを整理していくね！\n\n" +
  "最初に【求職者ID】を教えてね。※メールに届いているIDだよ。";

export default function Home() {
  const [messages, setMessages] = useState([{ type: "ai", content: firstAI }]);
  const [status, setStatus] = useState(statusInit);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));
  const [step, setStep] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const listRef = useRef(null);
  const taRef = useRef(null);

  // 進捗バー用
  const MAX_STEP = 7;
  const progress = Math.min(
    100,
    Math.max(0, Math.round((step / MAX_STEP) * 100))
  );

  // スクロール最下部へ
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

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

      // ステータス・ステップ更新
      if (data.status) setStatus(data.status);
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
      0.5: "基本情報",
      1: "基本情報",
      2: "転職理由",
      3: "絶対条件",
      4: "希望条件",
      5: "これまで（Can）",
      6: "これから（Will）",
      7: "完了",
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
    <main className="chat list" ref={listRef}>
      {messages.map((m, i) => (
        <div key={i} className={`msg ${m.type}`}>
          {m.type === "ai" ? (
            <>
              <div className="avatar ai">🤖</div>
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
    </main>

    {/* 入力欄 */}
    <footer className="input-bar">
      <div className="input-inner">
        <textarea
          ref={taRef}
          className="textarea"
          placeholder={
            step === 0
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
