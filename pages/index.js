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
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [tagsMap, setTagsMap] = useState(new Map());
  const [qualificationsMap, setQualificationsMap] = useState(new Map());

  // STEP到達時に1度だけポーズを切り替えるためのフラグ
  const cheeredIdRef = useRef(false);   // STEP2
  const cheeredMustRef = useRef(false); // STEP4
  const cheeredSelfRef = useRef(false); // STEP5
  const cheeredDoneRef = useRef(false); // STEP6

function toBadges(resp, _currStep) {
  const st = resp?.status ?? {};

  const joinIds = (arr) =>
    Array.isArray(arr) && arr.length ? arr.map((id) => `ID:${id}`).join(",") : "";

  const joinTxt = (arr) =>
    Array.isArray(arr) && arr.length ? arr.join("／") : "";

  return {
    // 資格：qual_ids（ID）、なければrole_ids（ID）のみを表示
    資格: joinIds(st?.qual_ids) || joinIds(st?.role_ids) || "未入力",
    // Can / Will：配列でも単文でも受ける
    Can: Array.isArray(st?.can_texts)
      ? st.can_texts.join("／")
      : st?.can_text
        ? String(st.can_text)
        : "未入力",

    Will: Array.isArray(st?.will_texts)
      ? st.will_texts.join("／")
      : st?.will_text
        ? String(st.will_text)
        : "未入力",
    // Must: status_barがあればそれを使用、なければIDまたはテキスト
    Must:
      st?.status_bar
        ? st.status_bar
        : joinIds(st?.must_have_ids) ||
          joinIds(st?.ng_ids) ||
          joinTxt(st?.memo?.must_have_raw) ||
          "未入力",
    // 私はこんな人：self_textを使用
    私はこんな人: st?.self_text ? String(st.self_text) : "未入力",
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

  // ポーズを元に戻すタイマー保持
  const revertTimerRef = useRef(null);

  // 進捗バー
  const MAX_STEP = 7;
  const progress = Math.min(100, Math.max(0, Math.round((step / MAX_STEP) * 100)));

  // セッションがリセットされたらフラグも戻す
  useEffect(() => {
    if (step <= 1) {
      cheeredIdRef.current = false;
      cheeredMustRef.current = false;
      cheeredSelfRef.current = false;
      cheeredDoneRef.current = false;
    }
  }, [step]);

  // tags.jsonとqualifications.jsonを読み込んでIDからラベルに変換するマップを作成
  useEffect(() => {
    // tags.json（職場タグ用）
    fetch('/tags.json')
      .then(res => res.json())
      .then(data => {
        const map = new Map();
        if (data.tags && Array.isArray(data.tags)) {
          data.tags.forEach(tag => {
            if (tag.id && tag.name) {
              map.set(tag.id, tag.name);
            }
          });
        }
        setTagsMap(map);
      })
      .catch(err => console.error('Failed to load tags.json:', err));

    // qualifications.json（資格用）
    fetch('/qualifications.json')
      .then(res => res.json())
      .then(data => {
        const map = new Map();
        if (data.qualifications && Array.isArray(data.qualifications)) {
          data.qualifications.forEach(qual => {
            if (qual.id && qual.name) {
              map.set(qual.id, qual.name);
            }
          });
        }
        setQualificationsMap(map);
      })
      .catch(err => console.error('Failed to load qualifications.json:', err));
  }, []);

  // ID文字列をラベルに変換する関数（資格用とタグ用で使い分け）
  function convertIdsToLabels(idString, isQualification = false) {
    if (!idString || typeof idString !== "string" || !idString.includes("ID")) {
      return idString;
    }
    const map = isQualification ? qualificationsMap : tagsMap;

    const parts = idString
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    const labelsWithIds = parts
      .map((part) => {
        const match = part.match(/^ID[:]?(\d+)(?:\/(\w+))?$/i);
        if (!match) return null;
        const id = Number(match[1]);
        if (Number.isNaN(id)) return null;
        const direction = match[2]?.toLowerCase();
        const label = map.get(id);
        if (!label) return `ID${id}`;
        if (direction === "ng") return `ID${id}：${label}（なし）`;
        if (direction === "pending") return `ID${id}：${label}（保留）`;
        return `ID${id}：${label}`;
      })
      .filter(Boolean);

    return labelsWithIds.length > 0 ? labelsWithIds.join("、") : idString;
  }

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

      // 【特殊処理】STEP6完了時：最終メッセージ → 3秒後 → 仮シートをタブで表示
      if (data.meta?.show_summary_after_delay && data.meta?.summary_data) {
        // 最終メッセージを\n\nで分割して表示
        const finalParts = (data.response || "").split("\n\n").filter(Boolean);
        
        if (finalParts.length > 0) {
          // 最初の部分を即座に表示
          setAiTexts([finalParts[0]]);
          setIsTyping(false);
          
          // 2つ目以降があれば3秒後に表示
          if (finalParts.length > 1) {
            setTimeout(() => {
              setAiTexts(finalParts);
            }, 3000);
          }
          
          // さらに3秒後に仮シートを表示（最後のメッセージが表示されてから）
          const sheetDelay = finalParts.length > 1 ? 6000 : 3000;
          setTimeout(() => {
            setSummaryData(data.meta.summary_data);
            setShowSummary(true);
          }, sheetDelay);
        } else {
          // メッセージがない場合は即座に表示
          setAiTexts([data.response]);
          setIsTyping(false);
          setTimeout(() => {
            setSummaryData(data.meta.summary_data);
            setShowSummary(true);
          }, data.meta.show_summary_after_delay);
        }
      } else if (responseParts.length === 0 || !data.response || data.response.trim() === "") {
        setAiTexts(["（応答を処理中...）"]);
        setIsTyping(false);
        console.warn("[Frontend] Empty response received from server");
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

      {/* ステータスバッジ（仮シート表示時は非表示） */}
      {!showSummary && (
        <>
          <div className="status-row">
            {[
              "資格",
              "Can",
              "Will",
              "Must",
              "私はこんな人",
              "Doing",
              "Being",
            ].map((k) => {
              const value = displayBadgeValue(k, status[k]);
              let displayValue = value;
              if (k === "資格") {
                // 資格はqualifications.jsonを使う
                displayValue = convertIdsToLabels(value, true);
              } else if (k === "Must") {
                // Mustはtags.jsonを使う
                displayValue = convertIdsToLabels(value, false);
              }
              return (
                <span key={k} className="badge">
                  {k}：{displayValue}
                </span>
              );
            })}
          </div>

          {/* ステータス進捗バー */}
          <div className="status-progress">
            <div
              className="status-progress__inner"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      )}

      {/* キャリアの説明書（モーダル表示） */}
      {showSummary && summaryData && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          overflow: "auto"
        }}>
          <div style={{
            background: "linear-gradient(180deg, #fdf2f8 0%, #f5f3ff 45%, #eff6ff 100%)",
            borderRadius: "16px",
            padding: "24px",
            maxWidth: "1200px",
            width: "100%",
            maxHeight: "90vh",
            overflow: "auto",
            position: "relative",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)"
          }}>
            <button
              onClick={() => {
                setShowSummary(false);
                setSummaryData(null);
              }}
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "white",
                border: "none",
                borderRadius: "50%",
                width: "36px",
                height: "36px",
                fontSize: "20px",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#6b7280"
              }}
            >
              ×
            </button>
            <h2 style={{
              marginTop: 0,
              marginBottom: "24px",
              fontSize: "clamp(20px, 4vw, 28px)",
              fontWeight: 800,
              background: "linear-gradient(90deg, #ec4899, #3b82f6)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textAlign: "center"
            }}>
              キャリアの説明書
            </h2>
            
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "16px"
            }}>
              {/* カード形式で各項目を表示 */}
              {[
                { key: "資格", value: convertIdsToLabels(displayBadgeValue("資格", status["資格"]), true) },
                { key: "Can", subtitle: "活かせる強み", value: displayBadgeValue("Can", status["Can"]) },
                { key: "Will", subtitle: "やりたいこと", value: displayBadgeValue("Will", status["Will"]) },
                { key: "Must", subtitle: "譲れない条件", value: convertIdsToLabels(displayBadgeValue("Must", status["Must"]), false) },
                { key: "私はこんな人", value: displayBadgeValue("私はこんな人", status["私はこんな人"]) },
                { key: "Doing", subtitle: "行動・実践", value: displayBadgeValue("Doing", status["Doing"]) },
                { key: "Being", subtitle: "価値観・関わり方", value: displayBadgeValue("Being", status["Being"]) }
              ].map((item) => (
                <div key={item.key} style={{
                  backgroundColor: "white",
                  borderRadius: "12px",
                  padding: "20px",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                  border: "1px solid #e9d5ff"
                }}>
                  <h3 style={{
                    marginTop: 0,
                    marginBottom: "12px",
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "#f97316",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px"
                  }}>
                    <span>{item.key}</span>
                    {item.subtitle && (
                      <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 400 }}>
                        {item.subtitle}
                      </span>
                    )}
                  </h3>
                  <div style={{
                    fontSize: "14px",
                    lineHeight: "1.7",
                    whiteSpace: "pre-wrap",
                    color: "#1f2937"
                  }}>
                    {item.value || "未入力"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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
