import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
/* eslint-disable @next/next/no-img-element */

// 定期アニメーション用画像（ランダムに使用）12以外
const HOAP_ANIMATION_IMAGES = [
  "/hoap-wide.png",
  "/hoap-skip.png",
  "/10.png",
  "/11.png",
  "/13.png",
  "/14.png"
];

export default function Home() {
  // ← 最初は空配列でOK（ここは触らない）
  const [messages, setMessages] = useState([]);
  const [statusMeta, setStatusMeta] = useState({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));
  const [step, setStep] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [aiText, setAiText] = useState(""); // 現在表示中の吹き出し
  const [isTyping, setIsTyping] = useState(false);
  const [userEcho, setUserEcho] = useState("");
  const [choices, setChoices] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState(null);

  // STEP到達時に1度だけポーズを切り替えるためのフラグ
  const cheeredIdRef = useRef(false);   // STEP2
  const cheeredMustRef = useRef(false); // STEP4
  const cheeredSelfRef = useRef(false); // STEP5
  const cheeredDoneRef = useRef(false); // STEP6

function getStatusRowDisplay(key, statusMeta = {}) {
  const formatIds = (ids) =>
    Array.isArray(ids) && ids.length ? ids.map((id) => `ID:${id}`).join("、") : "";

  switch (key) {
    case "資格": {
      const value =
        formatIds(statusMeta.qual_ids) ||
        formatIds(statusMeta.role_ids) ||
        "";
      return value || "未入力";
    }
    case "Can": {
      const hasCan =
        (Array.isArray(statusMeta.can_texts) && statusMeta.can_texts.length > 0) ||
        Boolean(statusMeta.can_text);
      return hasCan ? "済" : "未入力";
    }
    case "Will": {
      const hasWill =
        (Array.isArray(statusMeta.will_texts) && statusMeta.will_texts.length > 0) ||
        Boolean(statusMeta.will_text);
      return hasWill ? "済" : "未入力";
    }
    case "Must": {
      if (typeof statusMeta.status_bar === "string" && statusMeta.status_bar.trim()) {
        return statusMeta.status_bar
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .join("、");
      }
      const ids = [
        ...(statusMeta.must_have_ids || []),
        ...(statusMeta.ng_ids || []),
        ...(statusMeta.pending_ids || []),
      ];
      const value = formatIds(ids);
      return value || "未入力";
    }
    case "私はこんな人": {
      return statusMeta.self_text ? "済" : "未入力";
}
    case "AIの分析": {
      const hasAnalysis =
        Boolean(statusMeta.ai_analysis) ||
        Boolean(statusMeta.strength_text) ||
        Boolean(statusMeta.doing_text) ||
        Boolean(statusMeta.being_text);
      return hasAnalysis ? "済" : "未出力";
    }
    default:
      return "未入力";
  }
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
  const normalizeChoiceKey = useCallback((s) => {
    return String(s || "")
      .replace(/\(/g, "（")
      .replace(/\)/g, "）")
      .replace(/\s+/g, " ")
      .trim();
  }, []);

  // 正規化キーで一意化
  const uniqueByNormalized = useCallback(
    (arr) => {
    const map = new Map();
    for (const item of arr || []) {
      const k = normalizeChoiceKey(item);
      if (!map.has(k)) map.set(k, item); // 先勝ち
    }
    return Array.from(map.values());
    },
    [normalizeChoiceKey]
  );

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
  const messageTimersRef = useRef([]);

  // ほーぷちゃん画像の切替用（初期は基本）
  const [hoapSrc, setHoapSrc] = useState("/hoap-basic.png");

  // ポーズを元に戻すタイマー保持
  const revertTimerRef = useRef(null);

  // isTyping用のランダム動きタイマー
  const typingAnimationTimerRef = useRef(null);

  // 進捗バー（STEP1〜6の6段階）
  const MAX_STEP = 6;
  const progress = Math.min(100, Math.max(0, Math.round((Math.min(step, MAX_STEP) / MAX_STEP) * 100)));

  // 画像のプリロード（画像が消える問題を防ぐ）
  useEffect(() => {
    const imagesToPreload = [
      "/hoap-basic.png",
      "/hoap-up.png",
      "/hoap-wide.png",
      "/hoap-skip.png",
      "/10.png",
      "/11.png",
      "/13.png",
      "/14.png"
    ];

    imagesToPreload.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  // セッションがリセットされたらフラグも戻す
  useEffect(() => {
    if (step <= 1) {
      cheeredIdRef.current = false;
      cheeredMustRef.current = false;
      cheeredSelfRef.current = false;
      cheeredDoneRef.current = false;
    }
  }, [step]);

  const clearMessageTimers = useCallback(() => {
    if (Array.isArray(messageTimersRef.current)) {
      messageTimersRef.current.forEach((timerId) => clearTimeout(timerId));
        }
    messageTimersRef.current = [];
  }, []);

  const showAiSequence = useCallback((parts) => {
    clearMessageTimers();
    if (!Array.isArray(parts) || parts.length === 0) {
      setAiText("");
      setIsTyping(false);
      return;
    }

    setAiText(parts[0]);
    setIsTyping(false);

    let delay = 0;
    for (let i = 1; i < parts.length; i++) {
      const prev = parts[i - 1] || "";
      const prevLength = prev.length || 0;
      const segmentDelay = Math.min(8000, 2600 + prevLength * 45);
      delay += segmentDelay;
      const timerId = setTimeout(() => {
        setAiText(parts[i]);
      }, delay);
      messageTimersRef.current.push(timerId);
    }
  }, [clearMessageTimers]);

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
          setAiText("");
        } else {
          showAiSequence(responseParts);
        }

        const next = data?.meta?.step ?? 0;
        setStatusMeta(data?.status || {});

        setStep(next);

        const inline = extractChoices(data.response);
setChoices(isChoiceStep(next) ? uniqueByNormalized(inline) : []);
      } catch (e) {
        setMessages([{ type: "ai", content: "初期メッセージの取得に失敗したよ🙏" }]);
      }
    })();
    return () => { aborted = true; };
  }, [sessionId, showAiSequence, uniqueByNormalized, clearMessageTimers]);

  // step変化でトリガー：ID取得後(2以上に到達)／完了(10)で一度だけバンザイ
  useEffect(() => {
    // タイマー整理
    if (revertTimerRef.current) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }

    // STEP2到達時：初回ID番号取得後
    if (step >= 2 && !cheeredIdRef.current) {
      cheeredIdRef.current = true;
      setHoapSrc("/hoap-up.png");
      revertTimerRef.current = setTimeout(() => {
        setHoapSrc("/hoap-basic.png");
        revertTimerRef.current = null;
      }, 2400);
      return;
    }

    // STEP4到達時：Must（譲れない条件）がまとまったら
    if (step >= 4 && !cheeredMustRef.current) {
      cheeredMustRef.current = true;
      setHoapSrc("/hoap-up.png");
      revertTimerRef.current = setTimeout(() => {
        setHoapSrc("/hoap-basic.png");
        revertTimerRef.current = null;
      }, 2400);
      return;
    }

    // STEP5到達時：Self（私はこんな人）がまとまったら
    if (step >= 5 && !cheeredSelfRef.current) {
      cheeredSelfRef.current = true;
      setHoapSrc("/hoap-up.png");
      revertTimerRef.current = setTimeout(() => {
        setHoapSrc("/hoap-basic.png");
        revertTimerRef.current = null;
      }, 2400);
      return;
    }

    // STEP6到達時：最終まとめ完了
    if (step >= 6 && !cheeredDoneRef.current) {
      cheeredDoneRef.current = true;
      setHoapSrc("/hoap-up.png");
      revertTimerRef.current = setTimeout(() => {
        setHoapSrc("/hoap-basic.png");
        revertTimerRef.current = null;
      }, 2400);
    }
  }, [step]);

  // AI応答が更新されるたびに、ランダム画像を短時間表示
  useEffect(() => {
    if (!aiText) return;

    // すでに「バンザイ」表示中なら邪魔しない（競合回避）
    if (hoapSrc === "/hoap-up.png") return;

    // 「ありがとう」が含まれている場合はバンザイ
    if (aiText.includes("ありがとう") || aiText.includes("ありがと")) {
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
      setHoapSrc("/hoap-up.png");
      revertTimerRef.current = setTimeout(() => {
        setHoapSrc("/hoap-basic.png");
        revertTimerRef.current = null;
      }, 2400);
      return;
    }

    // 33% くらいの確率でランダム画像を表示
    if (Math.random() < 0.33) {
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
      const randomImage = HOAP_ANIMATION_IMAGES[Math.floor(Math.random() * HOAP_ANIMATION_IMAGES.length)];
      setHoapSrc(randomImage);
      revertTimerRef.current = setTimeout(() => {
        // バンザイに上書きされていない場合のみ basic に戻す
        setHoapSrc((cur) => (cur === "/hoap-up.png" ? cur : "/hoap-basic.png"));
        revertTimerRef.current = null;
      }, 1600);
    }
  }, [aiText]);

  // isTypingが3秒以上続く場合、ランダムで動きを入れる
  useEffect(() => {
    if (isTyping) {
      // 3秒後にランダムな動きを表示
      typingAnimationTimerRef.current = setTimeout(() => {
        const randomPoses = ["/hoap-skip.png", "/hoap-wide.png", "/hoap-up.png"];
        const randomPose = randomPoses[Math.floor(Math.random() * randomPoses.length)];

        setHoapSrc(randomPose);

        // 800ms後に基本ポーズに戻す
        setTimeout(() => {
          setHoapSrc("/hoap-basic.png");
        }, 800);
      }, 3000);
    } else {
      // isTypingがfalseになったらタイマークリア
      if (typingAnimationTimerRef.current) {
        clearTimeout(typingAnimationTimerRef.current);
        typingAnimationTimerRef.current = null;
      }
    }

    return () => {
      if (typingAnimationTimerRef.current) {
        clearTimeout(typingAnimationTimerRef.current);
        typingAnimationTimerRef.current = null;
      }
    };
  }, [isTyping]);

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
    // モバイルの時だけキーボードを閉じる
    if (taRef.current && window.innerWidth <= 640) {
      taRef.current.blur();
    }

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
    // STEP6の場合は空文字列でもOK（DoingBeing生成開始）
    if (!text && step !== 6) return;

    setSending(true);

    // ユーザー入力を即時反映
    const userText = text;
    setUserEcho(userText);
    if (forcedText == null) setInput('');

    // タイピング開始
    setIsTyping(true);
    clearMessageTimers();
    setAiText("");

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
        showAiSequence([`${statusLine}\n${bodyLine}`]);
        setIsTyping(false);
        return;
      }

      // 本文反映（\n\n で分割して別々の吹き出しとして順次表示）
      const responseParts = (data.response || "").split("\n\n").filter(Boolean);

      // 【特殊処理】STEP6完了時：最終メッセージ → 3秒後 → 仮シートをタブで表示
      if (data.meta?.show_summary_after_delay && data.meta?.summary_data) {
        // 最終メッセージを\n\nで分割して表示
        const finalParts = (data.response || "").split("\n\n").filter(Boolean);
        
        if (finalParts.length > 0) {
          showAiSequence(finalParts);
          setIsTyping(false);
          
          let accumulatedDelay = 0;
          for (let i = 1; i < finalParts.length; i++) {
            const prev = finalParts[i - 1] || "";
            const prevLen = prev.length || 0;
            const segmentDelay = Math.min(8000, 2600 + prevLen * 45);
            accumulatedDelay += segmentDelay;
          }
          const lastPart = finalParts[finalParts.length - 1] || "";
          const lastReadTime = Math.min(9000, 3200 + (lastPart.length || 0) * 45);
          const sheetDelay = Math.max(5000, accumulatedDelay + lastReadTime);
          setTimeout(() => {
            setSummaryData(data.meta.summary_data);
            setShowSummary(true);
          }, sheetDelay);
        } else {
          // メッセージがない場合は即座に表示
          showAiSequence([data.response]);
          setIsTyping(false);
          setTimeout(() => {
            setSummaryData(data.meta.summary_data);
            setShowSummary(true);
          }, data.meta.show_summary_after_delay);
        }
      } else if (responseParts.length === 0 || !data.response || data.response.trim() === "") {
        showAiSequence(["（応答を処理中...）"]);
        setIsTyping(false);
        console.warn("[Frontend] Empty response received from server");
      } else if (responseParts.length === 1) {
        // 1つだけの場合は即座に表示
        showAiSequence([responseParts[0]]);
        setIsTyping(false);
      } else {
        // 複数ある場合は順次表示（差し替え形式）
        showAiSequence(responseParts);
        setIsTyping(false);
      }

      // 次ステップ
      const nextStep = data.meta && data.meta.step != null ? data.meta.step : step;

      // ステータス・ステップ更新
      setStatusMeta(data.status || {});
      setStep(nextStep);

      // STEP2〜6の時だけ選択肢抽出（STEP4はインライン固定ボタンも考慮）
      const serverOptions = Array.isArray(data.drill?.options) ? data.drill.options : [];
      const inline = getInlineChoices(nextStep, data.response, data.meta);
      const extracted = extractChoices(data.response);
      const choiceCandidates =
        serverOptions.length > 0
          ? serverOptions
          : inline.length > 0
            ? inline
            : extracted;
      setChoices(
        isChoiceStep(nextStep)
          ? uniqueByNormalized(choiceCandidates)
          : []
      );
    } catch (err) {
      console.error(err);
      showAiSequence(['通信エラーが発生したよ🙏']);
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
    6: "AI分析",
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
      clearMessageTimers();
    };
  }, [clearMessageTimers]);

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

      {/* ステータス進捗バー：STEP6で分析中の場合は専用表示 */}
      {step === 6 && showSummary ? (
        <div className="status-progress" style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#ec4899',
            zIndex: 1
          }}>分析中...</div>
          <div
            className="status-progress__inner"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : step <= 6 ? (
        <div className="status-progress">
          <div
            className="status-progress__inner"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {/* ステータスバッジ（仮シート表示時は非表示） */}
      {!showSummary && (
        <div className="status-row">
          {[
            "資格",
            "Can",
            "Will",
            "Must",
            "私はこんな人",
            "AIの分析",
          ].map((k) => {
            const displayValue = getStatusRowDisplay(k, statusMeta);
            return (
              <span key={k} className="badge">
                {k}：{displayValue}
              </span>
            );
          })}
        </div>
      )}

      <section className="duo-stage">
        <div className="duo-stage__bg" />
        <div className="duo-stage__wrap">
          <div className="duo-stage__hoap-container">
            <img className="duo-stage__hoap" src={hoapSrc} alt="ほーぷちゃん" />
          </div>
          <div className="duo-stage__bubbles-container">
            {isTyping ? (
              <div className="duo-stage__bubble typing" aria-live="polite">
                <span className="dots"><span>・</span><span>・</span><span>・</span></span>
              </div>
            ) : showChoices ? (
              <div className="duo-stage__bubble" aria-live="polite">
                下のボタンから選んでね！
              </div>
            ) : aiText ? (
              <div className="duo-stage__bubble" aria-live="polite">
                {aiText}
              </div>
            ) : (
              <div className="duo-stage__bubble" aria-live="polite">
                …
                </div>
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

      {/* キャリアの説明書（モーダル表示） - Instagram風 最高級UI */}
      {showSummary && summaryData && (
        <div className="summary-modal-overlay" style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(8px)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          overflow: "auto",
          animation: "fadeIn 0.3s ease-out"
        }}>
          <div className="summary-modal-container" style={{
            background: "linear-gradient(135deg, #fdf2f8 0%, #f5f3ff 50%, #eff6ff 100%)",
            borderRadius: "24px",
            padding: "clamp(20px, 4vw, 40px)",
            maxWidth: "1400px",
            width: "100%",
            maxHeight: "95vh",
            overflow: "auto",
            position: "relative",
            boxShadow: "0 25px 80px rgba(236, 72, 153, 0.15), 0 10px 40px rgba(0, 0, 0, 0.1)",
            border: "1px solid rgba(236, 72, 153, 0.1)"
          }}>
            {/* PDFダウンロードボタン */}
            <button
              className="summary-modal-btn"
              onClick={() => {
                window.print();
              }}
              style={{
                position: "absolute",
                top: "20px",
                right: "76px",
                background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                border: "none",
                borderRadius: "12px",
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "white",
                transition: "all 0.2s ease",
                zIndex: 10
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 16px rgba(59, 130, 246, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.3)";
              }}
            >
              <span>📄</span>
              <span>PDF保存</span>
            </button>

            {/* 閉じるボタン */}
            <button
              className="summary-modal-btn"
              onClick={() => {
                setShowSummary(false);
                setSummaryData(null);
              }}
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                border: "none",
                borderRadius: "50%",
                width: "44px",
                height: "44px",
                fontSize: "24px",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(236, 72, 153, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: 300,
                transition: "all 0.2s ease",
                zIndex: 10
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.1) rotate(90deg)";
                e.currentTarget.style.boxShadow = "0 6px 16px rgba(236, 72, 153, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1) rotate(0deg)";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(236, 72, 153, 0.3)";
              }}
            >
              ×
            </button>

            {/* タイトル */}
            <div className="summary-modal-title" style={{
              textAlign: "center",
              marginBottom: "clamp(24px, 4vw, 40px)"
            }}>
              <h2 style={{
                margin: 0,
                fontSize: "clamp(24px, 5vw, 36px)",
                fontWeight: 900,
                background: "linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                letterSpacing: "0.02em",
                marginBottom: "8px"
              }}>
                Your Unique Career Profile
              </h2>
            </div>

            <div className="summary-html" dangerouslySetInnerHTML={{ __html: summaryData }} />

            {/* フッター */}
            <div className="summary-modal-footer" style={{
              marginTop: "clamp(24px, 4vw, 32px)",
              paddingTop: "20px",
              borderTop: "1px solid rgba(236, 72, 153, 0.1)",
              textAlign: "center"
            }}>
              <p style={{
                margin: 0,
                fontSize: "12px",
                color: "#9ca3af",
                fontWeight: 500
              }}>
                Created with 💛 by ほーぷちゃん
              </p>
            </div>
          </div>
        </div>
      )}


      {/* チャット画面 */}
      <main className="chat" ref={listRef} />
      <div ref={bottomRef} />

     {/* ユーザーの吹き出し（入力欄の外に配置） */}
      {userEcho && (
        <div className="user-echo" aria-live="polite">
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
