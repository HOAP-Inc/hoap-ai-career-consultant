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
const [aiText, setAiText] = useState("");      // ほーぷちゃんの吹き出し用 文言
const [userEcho, setUserEcho] = useState("");  // 入力欄上のユーザー吹き出し用 文言

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

      setAiText(data.response);
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
    setAiText(data.response);
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

  <section className="duo-stage">
  <div className="duo-stage__bg" />
  <div className="duo-stage__wrap">
    <img className="duo-stage__hoap" src="/hoap-basic.png" alt="ほーぷちゃん" />
    <div className="duo-stage__bubble">
      {aiText || "…"}
    </div>
  </div>
</section>

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
   <main className="chat" ref={listRef} />

{/* 入力欄の直前に追記 */}
{userEcho && (
  <div className="user-echo">
    <div className="user-echo__bubble">{userEcho}</div>
  </div>
)}

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
/* ===== Duolingo風 単一吹き出しUI ===== */

/* 1) ほーぷちゃんステージ（ヘッダ直下の帯） */
.duo-stage{
  margin: 8px 0 12px;
  position: relative;
  height: 320px;                 /* 帯の高さ。必要なら調整 */
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--card-shadow);
}
.duo-stage__bg{
  position:absolute; inset:0;
  background: url("/beam-bg.png") center/cover no-repeat; /* 背景は固定 */
  filter: saturate(110%);
  opacity: .95;
}
.duo-stage__wrap{
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr; /* 左：キャラ / 右：吹き出し */
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
}

/* キャラをやや大きく、中央寄りに */
.duo-stage__hoap{
  width: min(420px, 90%);
  margin-left: auto;   /* 右寄せして中央側へ寄せる */
  display:block;
  filter: drop-shadow(0 6px 18px rgba(0,0,0,.28));
  transform-origin: 50% 85%;
  animation: hoapSway 3.8s ease-in-out infinite;
}
@keyframes hoapSway{
  0%,100%{ transform: rotate(0deg) translateY(0px) }
  50%    { transform: rotate(-1.6deg) translateY(2px) }
}

/* ほーぷちゃんの吹き出し（書き換え式） */
.duo-stage__bubble{
  align-self: center;
  justify-self: start;
  max-width: 520px;
  background: #fff;
  border: 1px solid #f3e8ff;
  border-radius: 16px;
  padding: 14px 16px;
  color: var(--text);
  line-height: 1.8;
  white-space: pre-wrap;
  position: relative;
  box-shadow: var(--card-shadow);
}
.duo-stage__bubble::before{
  content:"";
  position:absolute;
  left: -10px; top: 24px;        /* 吹き出しの尻尾（左向き） */
  width: 0; height: 0;
  border: 10px solid transparent;
  border-right-color: #fff;
  filter: drop-shadow(-1px 1px 0 rgba(243,232,255,1));
}

/* 2) 入力欄直上のユーザー吹き出し（書き換え式） */
.user-echo{
  position: sticky;    /* 入力欄の直上に追従 */
  bottom: 80px;        /* 入力欄の高さぶん調整 */
  z-index: 5;
  display:flex;
  justify-content: flex-end;
  margin: 8px 0;
  pointer-events: none;     /* クリックを透過（入力の邪魔をしない） */
}
.user-echo__bubble{
  pointer-events: auto;
  max-width: 70%;
  background: linear-gradient(135deg, var(--user-grad-from), var(--user-grad-via) 50%, var(--user-grad-to));
  border:1px solid #e9d5ff;
  border-radius: 16px;
  padding: 10px 12px;
  box-shadow: var(--card-shadow);
  white-space: pre-wrap;
}
