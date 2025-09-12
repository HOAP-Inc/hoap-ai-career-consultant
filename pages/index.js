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
const [isTyping, setIsTyping] = useState(false); // 返答待ちのタイピング表示
const [userEcho, setUserEcho] = useState("");  // 入力欄上のユーザー吹き出し用 文言

const listRef = useRef(null);
const taRef = useRef(null);
const bottomRef = useRef(null);

// ほーぷちゃん画像の切替用（初期は基本）
const [hoapSrc, setHoapSrc] = useState("/hoap-basic.png");

// 「ID取得後／完了後」のバンザイを一度だけにするためのフラグ
const cheeredIdRef = useRef(false);
const cheeredDoneRef = useRef(false);

// ポーズを元に戻すタイマー保持
const revertTimerRef = useRef(null);

  // 進捗バー
  const MAX_STEP = 9;
  const progress = Math.min(100, Math.max(0, Math.round((step / MAX_STEP) * 100)));

  // ステータス表示用：IDだけ出す。未マッチは 済。求職者IDは原文。
function displayIdsOrDone(key, val) {
  if (key === '求職者ID') return val ?? '';

  const s = String(val ?? '');
  if (!s || s === '未入力' || s === '0件') return '';

  // 「ID:…」部分を “ID:” 付きのまま取り出す
  const m = s.match(/(ID:[^）)]+)[）)]?/);
  return m ? m[1].trim() : '済';
}

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

  // step変化でトリガー：ID取得後(2以上に到達)／完了(9)で一度だけバンザイ
useEffect(() => {
  // タイマー整理
  if (revertTimerRef.current) {
    clearTimeout(revertTimerRef.current);
    revertTimerRef.current = null;
  }

  // 初回ID番号取得後（stepが2以上に上がった最初のタイミング）
  if (step >= 2 && !cheeredIdRef.current) {
    cheeredIdRef.current = true;
    setHoapSrc("/hoap-up.png");
    revertTimerRef.current = setTimeout(() => {
      setHoapSrc("/hoap-basic.png");
      revertTimerRef.current = null;
    }, 2400);
    return;
  }

  // 最後の回答が終わったあと（完了：step=9 の最初のタイミング）
  if (step >= 9 && !cheeredDoneRef.current) {
    cheeredDoneRef.current = true;
    setHoapSrc("/hoap-up.png");
    revertTimerRef.current = setTimeout(() => {
      setHoapSrc("/hoap-basic.png");
      revertTimerRef.current = null;
    }, 2400);
  }
}, [step]);

  // AI応答が更新されるたびに、ランダムで「手を広げる」を短時間表示
useEffect(() => {
  if (!aiText) return;

  // すでに「バンザイ」表示中なら邪魔しない（競合回避）
  if (hoapSrc === "/hoap-up.png") return;

  // 33% くらいの確率で手を広げる
  if (Math.random() < 0.33) {
    if (revertTimerRef.current) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
    setHoapSrc("/hoap-wide.png");
    revertTimerRef.current = setTimeout(() => {
      // バンザイに上書きされていない場合のみ basic に戻す
      setHoapSrc((cur) => (cur === "/hoap-up.png" ? cur : "/hoap-basic.png"));
      revertTimerRef.current = null;
    }, 1600);
  }
}, [aiText, hoapSrc]);

    // スマホのキーボード高さを CSS 変数 --kb に同期
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const syncKB = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${kb}px`);
    };
    syncKB();
    vv.addEventListener("resize", syncKB);
    vv.addEventListener("scroll", syncKB);
    return () => {
      vv.removeEventListener("resize", syncKB);
      vv.removeEventListener("scroll", syncKB);
    };
  }, []);
  
  // 最下部へスクロール（レイアウト確定後に実行）
useLayoutEffect(() => {
  const el = bottomRef.current;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "end" });
}, [messages.length, step]);
  // 送信処理
  async function onSend() {
    if (!input.trim() || sending) return;
    setSending(true);

    // ユーザー入力を即時反映（入力欄上のユーザー吹き出しに“上書き”）
    const userText = input;
    setUserEcho(userText);
    setInput("");

    // ここで「・・・」を即表示
    setIsTyping(true);
    setAiText("・・・");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, sessionId }),
      });
      const data = await res.json();

      // AI応答は“上書き”で表示（単一吹き出し）
      setAiText(data.response);
      setIsTyping(false);

      // ステータス・ステップ更新（meta.statusBar を使う）
if (data.meta?.statusBar) setStatus(data.meta.statusBar);
if (data.meta?.step != null) setStep(data.meta.step);
    } catch (err) {
      console.error(err);
     setAiText("通信エラーが発生したよ🙏");
     setIsTyping(false);
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

  function onFocusLock() {
    window.scrollTo(0, 0);
    document.body.style.height = "100dvh";
    document.body.style.overflow = "hidden";
  }
  function onFocusUnlock() {
    document.body.style.height = "";
    document.body.style.overflow = "";
    window.scrollTo(0, 0);
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

    // アンマウント時にポーズ復帰タイマーを必ず止める
  useEffect(() => {
    return () => {
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
    };
  }, []);

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
    <img className="duo-stage__hoap" src={hoapSrc} alt="ほーぷちゃん" />
    <div className={`duo-stage__bubble ${isTyping ? "typing" : ""}`} aria-live="polite">
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
          {k}：{displayIdsOrDone(k, status[k])}
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

{userEcho && (
  <div className="user-echo">
    <div className="user-echo__bubble">{userEcho}</div>
  </div>
)}

    {/* チャット画面 */}
   <main className="chat" ref={listRef} />
   <div ref={bottomRef} />   {/* ← これを追加 */}

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
  onChange={(e) => { setInput(e.target.value); }}
  onKeyDown={onKeyDown}
  onCompositionStart={() => setIsComposing(true)}
  onCompositionEnd={() => setIsComposing(false)}
  onBlur={() => { setIsComposing(false); onFocusUnlock(); }}  // ← 追加
  onFocus={onFocusLock}                                       // ← 追加
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
