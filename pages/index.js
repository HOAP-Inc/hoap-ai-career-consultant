// pages/index.js
+ import React, { useEffect, useRef, useState, Fragment } from "react";

+ const statusInit = {
+   求職者ID: "",
+   職種: "",
+   現職: "",
+   転職目的: "",
+   Must: "",
+   Want: "",
+   Can: "",
+   Will: "",
+ };

const firstAI =
  "こんにちは！\n担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。\n\n最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！";

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

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const pushUser = (text) => setMessages((m) => [...m, { type: "user", content: text }]);
  const pushAI = (text) => setMessages((m) => [...m, { type: "ai", content: text }]);

  const clearInput = () => {
    setInput("");
    if (taRef.current) taRef.current.value = "";
  };

  const onSend = async () => {
    const outgoing = (input || "").trim();
    if (!outgoing || sending) return;

    pushUser(outgoing);
    clearInput();

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
          history: messages.slice(-12),
        }),
      });
      if (!res.ok) throw new Error("API error");
     +      const data = await res.json();
+      // ステータスバー（サーバが整形済みの meta.statusBar を使う）
+      if (data?.meta?.statusBar) setStatus(data.meta.statusBar);
+      // Step は数値とラベルを両方保持
+      if (typeof data.step === "number") setStep(data.step);
+      if (data.response) pushAI(data.response);
    } catch {
      pushAI("ごめん、通信でエラーが出たみたい。もう一度送ってみてね。");
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    const imeNow =
      isComposing ||
      e.nativeEvent?.isComposing ||
      e.keyCode === 229; // 一部ブラウザのIME判定
    if (e.key === "Enter" && !e.shiftKey && !imeNow) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="container">
      <header className="header">
        <div className="title">
          <div>AIキャリアエージェント</div>
          <div>ほーぷちゃん</div>
        </div>
        +        <div className="step">Step {step + 1}/6　{statusStepLabel(step)}</div>
      </header>

      +      <div className="status-row">
+        {["求職者ID","職種","現職","転職目的","Must","Want","Can","Will"].map((k) => (
+          <span key={k} className="badge">{k}：{status[k] ?? ""}</span>
+        ))}
+      </div>

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
          <button type="button" className="send" onClick={onSend} disabled={sending}>
            ➤
          </button>
        </div>
      </footer>
    </div>
  );
}
function statusStepLabel(step) {
  // サーバ側 STEP_LABELS と一致させる（UI崩れ防止）
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
