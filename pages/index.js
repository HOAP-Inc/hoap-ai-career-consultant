import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const statusInit = {
  求職者ID: "未入力",
  職種: "未入力",
  現職: "未入力",
  転職目的: "未入力",   // reason_ids を ID列で表示
  Must_NG: "未入力",     // must_ng_ids を ID列で表示
  Must_have: "未入力",   // must_have_ids を ID列で表示
  Want: "未入力",        // テキスト
  Can: "未入力",         // テキスト
  Will: "未入力",        // テキスト
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
  const [choices, setChoices] = useState([]);

  // ▼ バッジ整形：API応答をフロント表示用にマップ
  function toBadges(resp) {
    const st = resp?.status ?? {};

    const joinIds = (arr) =>
      Array.isArray(arr) && arr.length ? `ID:${arr.join(",")}` : "未入力";

    return {
      求職者ID: st?.number ? `ID:${st.number}` : "未入力",
      職種: joinIds(st?.role_ids),
      現職: joinIds(st?.place_ids),

      転職目的: joinIds(st?.reason_ids),
      Must_NG: joinIds(st?.must_ng_ids),
      Must_have: joinIds(st?.must_have_ids),

      Want: st?.want_text ? String(st.want_text) : "未入力",
      Can: st?.can ? String(st.can) : "未入力",
      Will: st?.will ? String(st.will) : "未入力",
    };
  }

  // バッジの表示（空/未入力は出さない）
  function displayBadgeValue(_key, val) {
    const s = String(val ?? "").trim();
    return s && s !== "未入力" ? s : "";
  }

  // 対象ステップかを判定（STEP2〜6）
  function isChoiceStep(n) {
    return n >= 2 && n <= 6;
  }

  // 『［A］／［B］／［C］』形式から配列を作る
  function extractChoices(text) {
    if (!text) return [];
    const m = text.match(/『([^』]+)』/);
    if (!m) return [];

    const inner = m[1].trim();

    // 1) ［...］や[...] があれば、それぞれを選択肢として抜き出す
    const bracketRe = /[［\[]([^］\]]+)[］\]]/g;
    const picks = [];
    let mm;
    while ((mm = bracketRe.exec(inner)) !== null) {
      const s = mm[1].trim();
      if (s) picks.push(s);
    }

    // 2) ［］が無ければ「選択肢なし」
    return picks;
  }

  // 表記ゆれ正規化（() を全角に、空白を圧縮）
  function normalizeChoiceKey(s) {
    return String(s || "")
      .replace(/\(/g, "（")
      .replace(/\)/g, "）")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 正規化キーで一意化
  function uniqueByNormalized(arr) {
    const map = new Map();
    for (const item of arr || []) {
      const k = normalizeChoiceKey(item);
      if (!map.has(k)) map.set(k, item); // 先勝ち
    }
    return Array.from(map.values());
  }

  // Step4 の特定質問タイミングでは固定ボタンを出す
  function getInlineChoices(step, responseText, meta) {
    if (step === 4) {
      const t = String(responseText || "");
      // サーバの定型質問フレーズを検出（文言は現行そのまま）
      const hit = t.includes("一番ストレスだったのは、仕事内容・人間関係・労働時間のどれに近い？");
      if (hit) {
        return ["仕事内容", "人間関係", "労働時間"];
      }
    }
    return [];
  }

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
  const MAX_STEP = 10;
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

        // ▼ ステップ & バッジ
        const next = data?.meta?.step ?? 0;
        setStep(next);
        setStatus(toBadges(data)); // ← ここでバッジ整形

        // ▼ 選択肢
        const inline = getInlineChoices(next, data.response, data.meta);
        setChoices(
          isChoiceStep(next)
            ? uniqueByNormalized(inline.length ? inline : extractChoices(data.response))
            : []
        );
      } catch (e) {
        setMessages([{ type: "ai", content: "初期メッセージの取得に失敗したよ🙏" }]);
      }
    })();
    return () => { aborted = true; };
  }, [sessionId]);

  // step変化でトリガー：ID取得後(2以上に到達)／完了(10)で一度だけバンザイ
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

    // 最後の回答が終わったあと（完了：step=10 の最初のタイミング）
    if (step >= 10 && !cheeredDoneRef.current) {
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

  // 送信処理（選択肢ボタンからも呼べるように修正）
  async function onSend(forcedText) {
    // クリック時などに渡ってくる MouseEvent を無効化
    if (
      forcedText &&
      typeof forcedText === "object" &&
      ("nativeEvent" in forcedText || "preventDefault" in forcedText || "type" in forcedText)
    ) {
      forcedText = undefined;
    }
    if (sending) return;
    const text = forcedText != null ? String(forcedText) : input.trim();
    if (!text) return;

    setSending(true);

    // ユーザー入力を即時反映
    const userText = text;
    setUserEcho(userText);
    if (forcedText == null) setInput("");

    // タイピング開始
    setIsTyping(true);
    setAiText("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, sessionId }),
      });
      const data = await res.json();

      // 本文反映
      setAiText(data.response);
      setIsTyping(false);

      // 次ステップ
      const nextStep = data.meta?.step != null ? data.meta.step : step;

      // ▼ ステータス・ステップ更新（バッジを整形して適用）
      setStatus(toBadges(data));
      setStep(nextStep);

      // STEP2〜6の時だけ選択肢抽出（STEP4はインライン固定ボタンも考慮）
      const inline = getInlineChoices(nextStep, data.response, data.meta);
      setChoices(
        isChoiceStep(nextStep)
          ? uniqueByNormalized(inline.length ? inline : extractChoices(data.response))
          : []
      );
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
      5: "Must（NG）条件",
      6: "Must（Have）条件",
      7: "Want条件",
      8: "これまで（Can）",
      9: "これから（Will）",
      10: "完了",
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

  const showChoices = isChoiceStep(step) && choices.length > 0 && !isTyping;

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
            {isTyping ? (
              <span className="dots"><span>・</span><span>・</span><span>・</span></span>
            ) : (
              showChoices
                ? "どれが一番近い？下のボタンから選んでね！"
                : (aiText || "…")
            )}
          </div>
        </div>
      </section>

      {isChoiceStep(step) && choices.length > 0 && !isTyping && (
        <div className="choice-wrap">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              className="choice-btn"
              onClick={() => {
                onSend(c);      // タップした文言で即送信
                setChoices([]); // 二重送信防止で即非表示
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* ステータスバッジ */}
      <div className="status-row">
        {[
          "求職者ID",
          "職種",
          "現職",
          "転職目的",
          "Must_NG",
          "Must_have",
          "Want",
          "Can",
          "Will",
        ].map((k) => (
          <span key={k} className="badge">
            {k}：{displayBadgeValue(k, status[k])}
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
      <div ref={bottomRef} />   {/* ← これを追加 */}

     {/* 入力欄 */}
<footer className="input-bar">
  {/* 入力欄の“直上”に固定表示（横並びに巻き込まれない位置） */}
  {userEcho && (
    <div className="user-echo" aria-live="polite">
      <div className="user-echo__bubble">{userEcho}</div>
    </div>
  )}

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
      onBlur={() => { setIsComposing(false); onFocusUnlock(); }}
      onFocus={onFocusLock}
      autoComplete="off"
    />
    <button
      type="button"
      className="send"
      onClick={() => onSend()}
      disabled={sending}
    >
      ➤
    </button>
  </div>
</footer>
    </div>
  );
}
