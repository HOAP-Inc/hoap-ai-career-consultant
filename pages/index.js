import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const statusInit = {
  資格: "未入力",
  Can: "未入力",          // 60〜90字（将来的に複数でも表示は1本でOK）
  Will: "未入力",         // 60〜90字
  Must: "未入力",    // 既存IDロジックを流用
  私はこんな人: "未入力", // 180〜280字
  Doing: "未入力",        // 生成（約300字）
  Being: "未入力",        // 生成（約300字）
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
  const [aiTexts, setAiTexts] = useState([]); // 複数の吹き出しを格納
  const [isTyping, setIsTyping] = useState(false);
  const [userEcho, setUserEcho] = useState("");
  const [choices, setChoices] = useState([]);

function toBadges(resp, _currStep) {
  const st = resp?.status ?? {};

  const joinIds = (arr) =>
    Array.isArray(arr) && arr.length ? `ID:${arr.join(",")}` : "";

  const joinTxt = (arr) =>
    Array.isArray(arr) && arr.length ? arr.join("／") : "";

  return {
    // 資格：qual_ids（ID）、なければrole_ids（ID）のみを表示
    資格: joinIds(st?.qual_ids) || joinIds(st?.role_ids) || "未入力",
    // Can / Will：配列でも単文でも受ける
    Can: Array.isArray(st?.can_texts) ? st.can_texts.join("／")
       : (st?.can_text ? String(st.can_text) : "未入力"),

    Will: Array.isArray(st?.will_texts) ? st.will_texts.join("／")
        : (st?.will_text ? String(st.will_text) : "未入力"),
    Must: (joinIds(st?.must_have_ids) || joinTxt(st?.memo?.must_have_raw) || "未入力"),
    // 私はこんな人欄は削除（STEP5はステータスバーに表示しない）
    Doing: st?.doing_text ? String(st.doing_text) : "未入力",
    Being: st?.being_text ? String(st.being_text) : "未入力",
  };
}

  function displayBadgeValue(_key, val) {
    const s = String(val ?? "").trim();
    return s && s !== "未入力" ? s : "";
  }

  function isChoiceStep(n) {
   return n === 1 || n === 4;
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
  function getInlineChoices(step, responseText, _meta) {
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
  const MAX_STEP = 7;
  const progress = Math.min(100, Math.max(0, Math.round((step / MAX_STEP) * 100)));

  // ★最初の挨拶をサーバーから1回だけ取得
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '', sessionId }),
});
const raw = await res.text();
const data = raw ? JSON.parse(raw) : null;
        if (aborted) return;

        // 初回メッセージも \n\n で分割して順次表示（差し替え形式）
        const responseParts = (data.response || "").split("\n\n").filter(Boolean);
        if (responseParts.length === 0) {
          setAiTexts([]);
        } else if (responseParts.length === 1) {
          setAiTexts([responseParts[0]]);
        } else {
          // 最初の吹き出しを即座に表示
          setAiTexts([responseParts[0]]);
          // 2つ目以降を3秒ずつ遅延して差し替え（追加ではなく）
          for (let i = 1; i < responseParts.length; i++) {
            const index = i;
            setTimeout(() => {
              setAiTexts([responseParts[index]]); // 配列全体を差し替え
            }, 3000 * index);
          }
        }

        const next = data?.meta?.step ?? 0;
        setStatus(toBadges(data, next));

        setStep(next);

        const inline = extractChoices(data.response);
setChoices(isChoiceStep(next) ? uniqueByNormalized(inline) : []);
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

    if (step >= 6 && !cheeredDoneRef.current) {
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
    if (aiTexts.length === 0) return;

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
  }, [aiTexts, hoapSrc]);

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
      typeof forcedText === 'object' &&
      ('nativeEvent' in forcedText || 'preventDefault' in forcedText || 'type' in forcedText)
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
    if (forcedText == null) setInput('');

    // タイピング開始
    setIsTyping(true);
    setAiTexts([]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, sessionId }),
      });

      // 常にテキストで受けてから JSON を試す（405 等で本文空でも落ちない）
      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!res.ok || !data) {
        // サーバが JSON を返さない時は落とさず画面に可視化
        const statusLine = `サーバ応答: ${res.status}`;
        const bodyLine = raw ? `本文: ${raw.slice(0, 200)}` : '本文なし';
        setAiTexts([`${statusLine}\n${bodyLine}`]);
        setIsTyping(false);
        return;
      }

      // 本文反映（\n\n で分割して別々の吹き出しとして順次表示）
      const responseParts = (data.response || "").split("\n\n").filter(Boolean);

      // 【特殊処理】STEP6完了時：最終メッセージ → 1.5秒後 → 一覧表示
      if (data.meta?.show_summary_after_delay && data.meta?.summary_data) {
        // 最初に最終メッセージを表示
        setAiTexts([data.response]);
        setIsTyping(false);

        // 指定時間後に一覧データを表示
        setTimeout(() => {
          setAiTexts([data.meta.summary_data]);
        }, data.meta.show_summary_after_delay);
      } else if (responseParts.length === 0) {
        setAiTexts([]);
        setIsTyping(false);
      } else if (responseParts.length === 1) {
        // 1つだけの場合は即座に表示
        setAiTexts([responseParts[0]]);
        setIsTyping(false);
      } else {
        // 複数ある場合は順次表示（差し替え形式）
        setAiTexts([responseParts[0]]); // 最初の吹き出しを即座に表示
        setIsTyping(false);

        // 2つ目以降を3秒ずつ遅延して差し替え（追加ではなく置き換え）
        for (let i = 1; i < responseParts.length; i++) {
          const index = i;
          setTimeout(() => {
            setAiTexts([responseParts[index]]); // 配列全体を差し替え
          }, 3000 * index);
        }
      }

      // 次ステップ
      const nextStep = data.meta && data.meta.step != null ? data.meta.step : step;

      // ステータス・ステップ更新（バッジを整形して適用）
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
      setAiTexts(['通信エラーが発生したよ🙏']);
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
    1: "資格",
    2: "Can",
    3: "Will",
    4: "Must",
    5: "私はこんな人",
    6: "分析（Doing/Being）",
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
          <div>AIキャリアデザイナー</div>
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
          <div className="duo-stage__bubbles-container">
            {isTyping ? (
              <div className="duo-stage__bubble typing" aria-live="polite">
                <span className="dots"><span>・</span><span>・</span><span>・</span></span>
              </div>
            ) : showChoices ? (
              <div className="duo-stage__bubble" aria-live="polite">
                下のボタンから選んでね！
              </div>
            ) : aiTexts.length === 0 ? (
              <div className="duo-stage__bubble" aria-live="polite">
                …
              </div>
            ) : (
              aiTexts.map((text, index) => (
                <div key={index} className="duo-stage__bubble" aria-live="polite">
                  {text}
                </div>
              ))
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
                onSend(c); 
                setChoices([]);
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
  "資格",
  "Can",
  "Will",
  "Must",
  "私はこんな人",
  "Doing",
  "Being",
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
{/* 最終確認（step>=6で表示）：全STEPの折りたたみ一覧 */}
{step >= 6 && (
  <section aria-label="最終確認" style={{ padding: "12px 16px" }}>
    {/* 1) 資格 */}
    <details>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>資格</summary>
      <div style={{ marginTop: 8 }}>
        {displayBadgeValue("資格", status["資格"]) || "未入力"}
      </div>
    </details>

    {/* 2) Can */}
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Can（今後も活かしたい強み）</summary>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {displayBadgeValue("Can", status["Can"]) || "未入力"}
      </div>
    </details>

    {/* 3) Will */}
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Will（これから挑戦したいこと）</summary>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {displayBadgeValue("Will", status["Will"]) || "未入力"}
      </div>
    </details>

    {/* 4) Must */}
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Must（Have）</summary>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {displayBadgeValue("Must", status["Must"]) || "未入力"}
      </div>
    </details>

    {/* 5) 私はこんな人 */}
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>私はこんな人</summary>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {displayBadgeValue("私はこんな人", status["私はこんな人"]) || "未入力"}
      </div>
    </details>

    {/* 6) Doing（初期は閉じる／好みでopenに） */}
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Doing（行動・実践）</summary>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {displayBadgeValue("Doing", status["Doing"]) || "未入力"}
      </div>
    </details>

    {/* 7) Being（初期は開く） */}
    <details open style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Being（価値観・関わり方）</summary>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {displayBadgeValue("Being", status["Being"]) || "未入力"}
      </div>
    </details>
  </section>
)}


      {/* チャット画面 */}
      <main className="chat" ref={listRef} />
      <div ref={bottomRef} /> 

     {/* 入力欄 */}
<footer className="input-bar">
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
    ? "お持ちの資格名を入力してください（例：正看護師、准看護師、介護福祉士…）"
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
