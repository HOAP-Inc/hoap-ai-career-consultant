import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const statusInit = {
  資格: "未入力",
  Can: "未入力",
  Will: "未入力",
  Must_have: "未入力",
  私はこんな人: "未入力",
  Doing: "未入力",
  Being: "未入力",
};

const INITIAL_AI_TEXT =
  "こんにちは！まずは保有している資格があれば教えてね。\n資格がない場合は「未資格」でOK。";

function createSessionId() {
  return Math.random().toString(36).slice(2);
}

const STATUS_FIELDS = [
  "qual_ids",
  "can_text",
  "will_text",
  "must_have_ids",
  "must_have_text",
  "self_text",
  "doing_text",
  "being_text",
];

function mergeStatus(base, patch) {
  const next = { ...base };
  if (!patch || typeof patch !== "object") return next;
  for (const key of STATUS_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key];
    }
  }
  return next;
}

function statusToBadges(status) {
  const s = status || {};
  const joinIds = (arr) => (Array.isArray(arr) && arr.length ? `ID:${arr.join(",")}` : "");
  return {
    資格: joinIds(s.qual_ids) || "未入力",
    Can: s.can_text ? String(s.can_text) : "未入力",
    Will: s.will_text ? String(s.will_text) : "未入力",
    Must_have: joinIds(s.must_have_ids) || (s.must_have_text ? String(s.must_have_text) : "未入力"),
    私はこんな人: s.self_text ? String(s.self_text) : "未入力",
    Doing: s.doing_text ? String(s.doing_text) : "未入力",
    Being: s.being_text ? String(s.being_text) : "未入力",
  };
}

function displayBadgeValue(_key, val) {
  const text = String(val ?? "").trim();
  return text && text !== "未入力" ? text : "";
}

function normalizeChoiceKey(s) {
  return String(s || "")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueByNormalized(arr) {
  const map = new Map();
  for (const item of arr || []) {
    const key = normalizeChoiceKey(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function extractChoices(text) {
  if (!text) return [];
  const match = text.match(/『([^』]+)』/);
  if (!match) return [];
  const inner = match[1].trim();
  const picks = [];
  const bracketRe = /[［\[]([^］\]]+)[］\]]/g;
  let mm;
  while ((mm = bracketRe.exec(inner)) !== null) {
    const choice = mm[1].trim();
    if (choice) picks.push(choice);
  }
  return picks;
}

function isChoiceStep(step) {
  return step === 1 || step === 4;
}

const COMPLETION_MESSAGE = "すべてのステップが完了したよ！お疲れさま😊";

export default function Home() {
  const [statusPayload, setStatusPayload] = useState({});
  const [statusBadges, setStatusBadges] = useState(statusInit);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(() => createSessionId());
  const [meta, setMeta] = useState({ step: 1 });
  const [step, setStep] = useState(1);
  const [isComposing, setIsComposing] = useState(false);
  const [aiText, setAiText] = useState(INITIAL_AI_TEXT);
  const [isTyping, setIsTyping] = useState(false);
  const [userEcho, setUserEcho] = useState("");
  const [choices, setChoices] = useState([]);
  const [hoapSrc, setHoapSrc] = useState("/hoap-basic.png");
  const cheeredIdRef = useRef(false);
  const cheeredDoneRef = useRef(false);
  const revertTimerRef = useRef(null);
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  const MAX_STEP = 6;
  const progress = Math.min(100, Math.max(0, Math.round((Math.min(step, MAX_STEP) / MAX_STEP) * 100)));

  useLayoutEffect(() => {
    const el = bottomRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [aiText, choices, step]);

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

  useEffect(() => {
    if (revertTimerRef.current) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
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

  useEffect(() => {
    if (!aiText) return;
    if (hoapSrc === "/hoap-up.png") return;
    if (Math.random() < 0.33) {
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
      setHoapSrc("/hoap-wide.png");
      revertTimerRef.current = setTimeout(() => {
        setHoapSrc((cur) => (cur === "/hoap-up.png" ? cur : "/hoap-basic.png"));
        revertTimerRef.current = null;
      }, 1600);
    }
  }, [aiText, hoapSrc]);

  useEffect(() => () => {
    if (revertTimerRef.current) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
  }, []);

  function statusStepLabel(current) {
    const map = {
      1: "資格",
      2: "Can",
      3: "Will",
      4: "Must（Have）",
      5: "私はこんな人",
      6: "分析（Doing/Being）",
    };
    return map[current] ?? "";
  }

  function updateChoices(nextStep, response) {
    const inline = extractChoices(response);
    if (isChoiceStep(nextStep)) {
      setChoices(uniqueByNormalized(inline));
    } else {
      setChoices([]);
    }
  }

  async function requestChat({ userMessage, metaOverride, statusOverride, sessionIdOverride }) {
    const payload = {
      userMessage,
      status: statusOverride ?? statusPayload,
      meta: metaOverride ?? meta,
      sessionId: sessionIdOverride ?? sessionId,
    };
    const res = await fetch("/api/v2/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error("JSON parse error", err);
      data = null;
    }
    if (!res.ok || !data) {
      const statusLine = `サーバ応答: ${res.status}`;
      const bodyLine = raw ? `本文: ${raw.slice(0, 200)}` : "本文なし";
      throw new Error(`${statusLine}\n${bodyLine}`);
    }
    const nextStatus = mergeStatus(statusOverride ?? statusPayload, data.status || {});
    setStatusPayload(nextStatus);
    setStatusBadges(statusToBadges(nextStatus));
    return { data, nextStatus };
  }

  async function fetchStepIntro(targetStep, statusOverride, sessionIdOverride) {
    setIsTyping(true);
    try {
      const { data } = await requestChat({
        userMessage: "",
        metaOverride: { step: targetStep, phase: "intro" },
        statusOverride,
        sessionIdOverride,
      });
      if (data?.meta) {
        setMeta(data.meta);
        setStep(Math.min(data.meta.step ?? targetStep, 7));
      } else {
        setMeta({ step: targetStep, phase: "intro" });
        setStep(Math.min(targetStep, 7));
      }
      setAiText(data?.response || "");
      updateChoices(targetStep, data?.response || "");
    } catch (err) {
      console.error(err);
      setAiText("初期メッセージの取得に失敗したよ🙏");
    } finally {
      setIsTyping(false);
    }
  }

  async function onSend(forcedText) {
    if (forcedText && typeof forcedText === "object" && ("nativeEvent" in forcedText || "preventDefault" in forcedText)) {
      forcedText = undefined;
    }
    if (sending) return;
    const text = forcedText != null ? String(forcedText) : input.trim();
    if (!text && meta.step !== 1) return;

    setSending(true);
    const userText = text;
    if (userText) {
      setUserEcho(userText);
    } else {
      setUserEcho("");
    }
    if (forcedText == null) setInput("");
    setIsTyping(true);
    setAiText("");

    try {
      if (meta.step >= 7) {
        const freshSessionId = createSessionId();
        setSessionId(freshSessionId);
        setStatusPayload({});
        setStatusBadges(statusInit);
        setMeta({ step: 1 });
        setStep(1);
        setChoices([]);
        cheeredIdRef.current = false;
        cheeredDoneRef.current = false;
        setHoapSrc("/hoap-basic.png");

        const { data, nextStatus } = await requestChat({
          userMessage: userText,
          metaOverride: { step: 1 },
          statusOverride: {},
          sessionIdOverride: freshSessionId,
        });

        const nextStepValue = data?.meta?.step ?? 1;
        setMeta({ step: nextStepValue, phase: "intro" });
        setStep(Math.min(nextStepValue, 7));
        setChoices([]);

        if (nextStepValue >= 2 && nextStepValue <= 6) {
          await fetchStepIntro(nextStepValue, nextStatus, freshSessionId);
        } else if (nextStepValue === 7) {
          setAiText(COMPLETION_MESSAGE);
        } else {
          setAiText(INITIAL_AI_TEXT);
        }
        return;
      }

      if (meta.step === 1) {
        const { data, nextStatus } = await requestChat({
          userMessage: userText,
          metaOverride: { step: 1 },
        });
        const nextMeta = data?.meta ?? { step: 1 };
        const nextStepValue = nextMeta.step ?? 1;
        setMeta(nextMeta);
        setStep(Math.min(nextStepValue, 7));

        if (nextStepValue === 1) {
          const responseText = data?.response || "";
          setAiText(responseText || INITIAL_AI_TEXT);
          updateChoices(1, responseText);
        } else {
          setChoices([]);
          if (nextStepValue >= 2 && nextStepValue <= 6) {
            await fetchStepIntro(nextStepValue, nextStatus);
          } else if (nextStepValue === 7) {
            setAiText(COMPLETION_MESSAGE);
          } else {
            setAiText("");
          }
        }
        return;
      }

      const payloadMeta = meta?.phase ? meta : { step: meta.step, phase: "intro" };
      const { data, nextStatus } = await requestChat({
        userMessage: userText,
        metaOverride: payloadMeta,
      });
      const nextMeta = data?.meta ?? {};
      if (nextMeta.phase) {
        setMeta(nextMeta);
        setStep(Math.min(nextMeta.step ?? step, 7));
        const responseText = data?.response || "";
        setAiText(responseText);
        updateChoices(nextMeta.step ?? step, responseText);
      } else {
        const nextStepValue = nextMeta.step ?? step;
        setMeta({ step: nextStepValue, phase: "intro" });
        setStep(Math.min(nextStepValue, 7));
        setChoices([]);
        if (nextStepValue === 7) {
          setAiText(COMPLETION_MESSAGE);
        } else if (nextStepValue >= 2 && nextStepValue <= 6) {
          await fetchStepIntro(nextStepValue, nextStatus);
        } else {
          setAiText("");
        }
      }
    } catch (err) {
      console.error(err);
      setAiText("通信エラーが発生したよ🙏");
    } finally {
      setIsTyping(false);
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

  const showChoices = isChoiceStep(step) && choices.length > 0 && !isTyping;

  return (
    <div className="container">
      <header className="header">
        <div className="title">
          <div>AIキャリアデザイナー</div>
          <div>ほーぷちゃん</div>
        </div>
        <div className="step">
          Step {Math.min(step, MAX_STEP)}/{MAX_STEP}　{statusStepLabel(step)}
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
              showChoices ? "下のボタンから選んでね！" : (aiText || "…")
            )}
          </div>
        </div>
      </section>

      {showChoices && (
        <div className="choice-wrap">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className="choice-btn"
              onClick={() => {
                onSend(choice);
                setChoices([]);
              }}
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      <div className="status-row">
        {["資格", "Can", "Will", "Must_have", "私はこんな人", "Doing", "Being"].map((k) => (
          <span key={k} className="badge">
            {k}：{displayBadgeValue(k, statusBadges[k])}
          </span>
        ))}
      </div>

      <div className="status-progress">
        <div className="status-progress__inner" style={{ width: `${progress}%` }} />
      </div>

      {step >= 6 && (
        <section aria-label="最終確認" style={{ padding: "12px 16px" }}>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>資格</summary>
            <div style={{ marginTop: 8 }}>{displayBadgeValue("資格", statusBadges["資格"]) || "未入力"}</div>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Can（今後も活かしたい強み）</summary>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{displayBadgeValue("Can", statusBadges["Can"]) || "未入力"}</div>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Will（これから挑戦したいこと）</summary>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{displayBadgeValue("Will", statusBadges["Will"]) || "未入力"}</div>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Must（Have）</summary>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{displayBadgeValue("Must_have", statusBadges["Must_have"]) || "未入力"}</div>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>私はこんな人</summary>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{displayBadgeValue("私はこんな人", statusBadges["私はこんな人"]) || "未入力"}</div>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Doing（行動・実践）</summary>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{displayBadgeValue("Doing", statusBadges["Doing"]) || "未入力"}</div>
          </details>
          <details open style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Being（価値観・関わり方）</summary>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{displayBadgeValue("Being", statusBadges["Being"]) || "未入力"}</div>
          </details>
        </section>
      )}

      <main className="chat" />
      <div ref={bottomRef} />

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
              meta.step === 1
                ? "お持ちの資格名を入力してください（例：看護師、准看護師、介護福祉士…）"
                : "メッセージを入力…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onBlur={() => {
              setIsComposing(false);
              onFocusUnlock();
            }}
            onFocus={onFocusLock}
            autoComplete="off"
          />
          <button type="button" className="send" onClick={() => onSend()} disabled={sending}>
            ➤
          </button>
        </div>
      </footer>
    </div>
  );
}
