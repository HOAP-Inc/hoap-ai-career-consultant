// pages/index.js
import { useEffect, useRef, useState } from "react";

const statusInit = {
  number: "未入力",
  job: "未入力",
  place: "未入力",
  reason: "未入力",
  must: "0件",
  want: "0件",
  can: "未入力",
  will: "未入力",
};

const firstAI =
  "こんにちは！\n担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。\n\n最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！";

export default function Home() {
  const [messages, setMessages] = useState([
    { type: "ai", content: firstAI },
  ]);
  const [status, setStatus] = useState(statusInit);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));
  const [step, setStep] = useState(0); // 0:ID, 1:職種/勤務先, …
  const listRef = useRef(null);
  const taRef = useRef(null);

  // 常に最下部へ
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const pushUser = (text) => {
    setMessages((m) => [...m, { type: "user", content: text }]);
  };
  const pushAI = (text) => {
    setMessages((m) => [...m, { type: "ai", content: text }]);
  };

  const onSend = async () => {
    const outgoing = input.trim();
    if (!outgoing || sending) return;

    // 先に表示＆入力クリア（確実に残らない）
    pushUser(outgoing);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          step,
          status,
          message: outgoing,
          history: messages.slice(-12), // 直近のみ送る（軽量）
        }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();

      // ステート反映
      if (data.status) setStatus(data.status);
      if (typeof data.step === "number") setStep(data.step);
      if (data.response) pushAI(data.response);
    } catch (e) {
      pushAI("ごめん、通信でエラーが出たみたい。もう一度送ってみてね。");
    } finally {
      setSending(false);
      // 送信後もフォーカスは保持
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="container">
      {/* ヘッダ */}
     <header className="header">
  <div className="title">AIキャリアエージェント：ほーぷちゃん</div>
  <div className="step">Step {step + 1}/6　基本情報</div>
</header>

      {/* ステータス */}
      <div className="status-row">
        <span className="badge">番号：{status.number}</span>
        <span className="badge">職種：{status.job}</span>
        <span className="badge">勤務先：{status.place}</span>
        <span className="badge">転職理由：{status.reason}</span>
        <span className="badge">Must：{status.must}</span>
        <span className="badge">Want：{status.want}</span>
        <span className="badge">Can：{status.can}</span>
        <span className="badge">Will：{status.will}</span>
      </div>
 {/* ステータスバー（進捗） */}
<div className="progress">
  <div className="progress-inner" style={{ width: `${(step / 6) * 100}%` }} />
</div>

      {/* チャット */}
      <main className="chat list" ref={listRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.type}`}>
          　  <div className={`avatar ${m.type}`}>
              {m.type === "ai" ? "🤖" : "👤"}
            </div>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
      </main>

      {/* 入力 */}
      <footer className="input-bar">
        <div className="input-inner">
          <textarea
            ref={taRef}
            className="textarea"
            placeholder={
              step === 0 ? "求職者IDを入力してください（メールに届いているID）…" : "メッセージを入力…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="send" onClick={onSend} disabled={sending}>
            ➤
          </button>
        </div>
      </footer>
    </div>
  );
}
