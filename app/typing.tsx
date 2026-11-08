"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Pause,
  Play,
  CheckCircle2,
  Home,
  Target,
  Timer,
  Keyboard,
} from "lucide-react";
import {
  sentences,
  compare,
  cpm,
  day,
  type Material,
  type RecordState,
} from "@/lib/study";
const empty = (): RecordState => ({
  input: "",
  elapsed: 0,
  mistakes: 0,
  completed: false,
  date: day(),
});
export default function Practice({
  material: m,
  onUpdate,
  onBack,
  onHome,
  status,
}: {
  material: Material;
  onUpdate: (m: Material) => void;
  onBack: () => void;
  onHome: () => void;
  status: string;
}) {
  const all = sentences(m);
  const [retry, setRetry] = useState<string[] | null>(null);
  const units = retry ? all.filter((s) => retry.includes(s.id)) : all;
  const index = Math.min(m.cursor, Math.max(0, units.length - 1));
  const unit = units[index];
  const record = m.records[unit?.id] || empty();
  const [visible, setVisible] = useState(record.input),
    [composing, setComposing] = useState(false),
    [paused, setPaused] = useState(false),
    [result, setResult] = useState(false),
    [auto, setAuto] = useState(true),
    [tick, setTick] = useState(0);
  const ime = useRef(false),
    clock = useRef<number | null>(null),
    area = useRef<HTMLTextAreaElement>(null),
    latest = useRef(m);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  function setClock(n: number | null) {
    clock.current = n;
    setRunningSince(n);
  }
  useEffect(() => {
    latest.current = m;
  }, [m]);
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const score = compare(unit?.text || "", record.input);
  const elapsed =
    record.elapsed +
    (runningSince === null ? 0 : Math.max(0, tick - runningSince));
  function updateInput(value: string) {
    if (!unit) return;
    const current = latest.current;
    const prev = current.records[unit.id] || empty();
    const normalized = value.normalize("NFC");
    const now = Date.now();
    const delta = clock.current === null ? 0 : Math.max(0, now - clock.current);
    setClock(now);
    setTick(now);
    const nextScore = compare(unit.text, normalized);
    const added = Math.max(
      0,
      Array.from(normalized).length - Array.from(prev.input).length,
    );
    const next = {
      ...prev,
      input: normalized,
      elapsed: prev.elapsed + delta,
      mistakes:
        prev.mistakes +
        (normalized !== prev.input && nextScore.correct < nextScore.total
          ? 1
          : 0),
      completed: nextScore.complete,
      date: day(),
    };
    const activity = [...current.activity];
    let today = activity.find((a) => a.date === day());
    if (!today) {
      today = { date: day(), chars: 0, elapsed: 0 };
      activity.push(today);
    }
    today.chars += added;
    today.elapsed += delta;
    const updated = {
      ...current,
      records: { ...current.records, [unit.id]: next },
      activity,
    };
    latest.current = updated;
    onUpdate(updated);
  }
  function stopClock() {
    if (clock.current !== null && !ime.current) updateInput(visible);
    setClock(null);
  }
  function navigate(n: number) {
    stopClock();
    const current = latest.current;
    const target = units[n];
    onUpdate({ ...current, cursor: n });
    setVisible(current.records[target.id]?.input || "");
    setComposing(false);
    ime.current = false;
    setClock(null);
    setTimeout(() => area.current?.focus(), 0);
  }
  function finish() {
    stopClock();
    setResult(true);
  }
  useEffect(() => {
    if (!auto || !score.complete || composing || paused || result) return;
    const id = setTimeout(() => {
      if (index < units.length - 1) navigate(index + 1);
      else finish();
    }, 650);
    return () => clearTimeout(id);
    // Navigation must use the current sentence; live updates cancel stale timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, score.complete, composing, paused, result, index, unit?.id]);
  function reset() {
    setClock(null);
    setVisible("");
    onUpdate({
      ...m,
      records: {
        ...m.records,
        [unit.id]: { ...empty(), mistakes: record.mistakes },
      },
    });
    setTimeout(() => area.current?.focus(), 0);
  }
  function retryWrong() {
    const ids = all
      .filter((s) => (m.records[s.id]?.mistakes || 0) > 0)
      .map((s) => s.id);
    if (!ids.length) return;
    const records = { ...m.records };
    ids.forEach((id) => {
      records[id] = empty();
    });
    setRetry(ids);
    onUpdate({ ...m, cursor: 0, records });
    setVisible("");
    setResult(false);
    setPaused(false);
    setClock(null);
  }
  const done = units.filter((s) => m.records[s.id]?.completed).length;
  const todayRecords = all
    .map((s) => ({ sentence: s, record: m.records[s.id] }))
    .filter((x) => x.record?.date === day());
  const totals = todayRecords.reduce(
    (a, { sentence, record }) => {
      const s = compare(sentence.text, record.input);
      return {
        chars: a.chars + s.total,
        correct: a.correct + s.correct,
        elapsed: a.elapsed + record.elapsed,
        done: a.done + Number(record.completed),
      };
    },
    { chars: 0, correct: 0, elapsed: 0, done: 0 },
  );
  const wrong = all.filter((s) => (m.records[s.id]?.mistakes || 0) > 0);
  if (!unit)
    return (
      <section className="card">
        <h1>연습할 문장이 없어요.</h1>
        <button onClick={onBack}>편집으로 돌아가기</button>
      </section>
    );
  if (result)
    return (
      <section className="results">
        <span className="round-icon">
          <CheckCircle2 size={32} />
        </span>
        <span className="eyebrow">조금씩, 꾸준히 쌓이는 나의 공부</span>
        <h1>오늘도 두다다, 잘했어요.</h1>
        <p>
          {m.title} · {done}/{units.length}문장 완료
        </p>
        <div className="stats">
          <div>
            <strong>
              {m.activity.find((a) => a.date === day())?.chars || 0}
            </strong>
            <span>오늘 입력한 글자</span>
          </div>
          <div>
            <strong>{totals.done}</strong>
            <span>오늘 완료한 문장</span>
          </div>
          <div>
            <strong>
              {totals.chars
                ? Math.round((totals.correct / totals.chars) * 100)
                : 100}
              %
            </strong>
            <span>오늘 정확도</span>
          </div>
          <div>
            <strong>{cpm(totals.correct, totals.elapsed)}</strong>
            <span>오늘 평균 CPM</span>
          </div>
        </div>
        <p className="hint">
          이 자료의 오늘 기록입니다. 정확도는 수정 후 현재 입력 기준이며, 오답
          목록은 수정 전 오타도 기억합니다.
        </p>
        <section className="card wrong-list">
          <h2>
            한 번 더 기억할 문장 <span className="count">{wrong.length}</span>
          </h2>
          {wrong.length ? (
            wrong.map((s) => (
              <p key={s.id}>
                <span className="tag">{s.page}페이지</span> {s.text}
              </p>
            ))
          ) : (
            <p>기록된 오타가 없어요. 다음 공부도 가볍게 시작해요.</p>
          )}
          <button
            className="primary"
            disabled={!wrong.length}
            onClick={retryWrong}
          >
            오답 다시 연습 <RotateCcw size={17} />
          </button>
        </section>
        <div className="row center">
          <button
            onClick={() => {
              setResult(false);
              setClock(null);
            }}
          >
            계속 연습하기
          </button>
          <button onClick={onHome}>
            <Home size={17} /> 내 공부방
          </button>
        </div>
        <p role="status">{status}</p>
      </section>
    );
  return (
    <section className="practice">
      <button
        className="back"
        onClick={() => {
          stopClock();
          onBack();
        }}
      >
        <ArrowLeft size={16} /> 자료 편집
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {retry ? "오답 재연습" : "나의 필사 시간"}
          </span>
          <h1>{m.title}</h1>
          <p>
            원문 {unit.page}페이지 ·{" "}
            {m.mode === "exact" ? "정확히 따라 치기" : "공부하기 편한 모드"}
          </p>
        </div>
        <span className="save-status" role="status">
          {status}
        </span>
      </div>
      <div className="stats">
        <div>
          <Keyboard size={19} />
          <strong>
            {index + 1}
            <small> / {units.length}</small>
          </strong>
          <span>현재 문장</span>
        </div>
        <div>
          <CheckCircle2 size={19} />
          <strong>{Math.round((done / units.length) * 100)}%</strong>
          <span>학습 진도</span>
        </div>
        <div>
          <Timer size={19} />
          <strong>
            {cpm(score.correct, elapsed)}
            <small> CPM</small>
          </strong>
          <span>타자 속도</span>
        </div>
        <div>
          <Target size={19} />
          <strong>{score.accuracy}%</strong>
          <span>정확도</span>
        </div>
      </div>
      <progress value={done} max={units.length} aria-label="학습 진도" />
      <div className="typing-card">
        <div className="row between">
          <span className="tag">
            {score.complete ? "완료했어요!" : "천천히 읽고, 따라 써 보세요"}
          </span>
          <label className="check-label">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />{" "}
            자동 다음 문장
          </label>
        </div>
        <div className="target" aria-label="따라 입력할 원문">
          {Array.from(unit.text).map((char, i) => {
            const v = Array.from(record.input);
            return (
              <span
                key={i}
                className={`${i < v.length ? (char === v[i] ? "correct" : "incorrect") : ""} ${i === v.length ? "caret" : ""}`}
              >
                {char}
              </span>
            );
          })}
          {Array.from(record.input).length > Array.from(unit.text).length && (
            <span className="incorrect">
              {Array.from(record.input)
                .slice(Array.from(unit.text).length)
                .join("")}
            </span>
          )}
        </div>
        <label htmlFor="typing-input" className="input-label">
          {composing
            ? "한글을 조합하고 있어요… 조합이 끝난 뒤 비교합니다."
            : paused
              ? "잠깐 쉬어가요. 준비되면 다시 시작하세요."
              : "아래에 따라 입력하세요"}
        </label>
        <textarea
          id="typing-input"
          ref={area}
          value={visible}
          disabled={paused}
          rows={4}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="타자 입력"
          onFocus={() => {
            if (!paused && clock.current === null) {
              setClock(Date.now());
              setTick(Date.now());
            }
          }}
          onBlur={() => {
            if (!ime.current) stopClock();
          }}
          onCompositionStart={() => {
            ime.current = true;
            setComposing(true);
          }}
          onCompositionUpdate={() => setComposing(true)}
          onCompositionEnd={(e) => {
            ime.current = false;
            setComposing(false);
            setVisible(e.currentTarget.value);
            updateInput(e.currentTarget.value);
          }}
          onChange={(e) => {
            setVisible(e.target.value);
            if (!ime.current && !(e.nativeEvent as InputEvent).isComposing)
              updateInput(e.target.value);
          }}
          placeholder="이곳을 누르고 두다다, 시작해 보세요."
        />
        <div className="row between">
          <span className="hint">
            {score.correct}/{Array.from(unit.text).length}글자 일치 · 띄어쓰기와
            문장부호도 함께 연습해요.
          </span>
          <span className="legend">
            <i /> 맞은 글자 <i /> 틀린 글자
          </span>
        </div>
        {score.complete && (
          <p role="status" className="complete">
            <CheckCircle2 size={17} /> 문장을 정확히 완성했어요.
          </p>
        )}
      </div>
      <div className="practice-controls">
        <button
          disabled={index === 0 || composing}
          onClick={() => navigate(index - 1)}
        >
          <ArrowLeft size={17} /> 이전 문장
        </button>
        <button disabled={composing} onClick={reset}>
          <RotateCcw size={17} /> 다시 입력
        </button>
        <button
          disabled={composing}
          onClick={() => {
            if (!paused) stopClock();
            setPaused(!paused);
          }}
        >
          {paused ? <Play size={17} /> : <Pause size={17} />}{" "}
          {paused ? "계속하기" : "잠깐 멈춤"}
        </button>
        <button
          disabled={composing}
          className="primary"
          onClick={() =>
            index < units.length - 1 ? navigate(index + 1) : finish()
          }
        >
          다음 문장 <ArrowRight size={17} />
        </button>
        <button disabled={composing} onClick={finish}>
          연습 종료
        </button>
      </div>
      <div className="reset-record">
        <button
          onClick={() => {
            if (confirm("이 자료의 모든 학습기록을 초기화할까요?")) {
              setClock(null);
              setRetry(null);
              setVisible("");
              onUpdate({ ...m, records: {}, activity: [], cursor: 0 });
            }
          }}
        >
          학습기록 초기화
        </button>
      </div>
    </section>
  );
}
