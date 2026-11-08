"use client";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Upload,
  FileText,
  ArrowRight,
  Sun,
  Moon,
  Trash2,
  ChevronLeft,
  ShieldCheck,
  Keyboard,
  Check,
  Download,
} from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import {
  createMaterial,
  parseRange,
  clean,
  sentences,
  type Material,
} from "@/lib/study";
import { listMaterials, saveMaterial, deleteMaterial } from "@/lib/storage";
import {
  openPdf,
  extractPage,
  pdfError,
  readingOrder,
  type Glyph,
} from "@/lib/pdf";
import PdfPreview from "./pdf-preview";
import Practice from "./typing";
export default function StudyApp() {
  const [library, setLibrary] = useState<Material[]>([]),
    [current, setCurrent] = useState<Material | null>(null),
    [screen, setScreen] = useState<"home" | "editor" | "practice">("home");
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [dark, setDark] = useState(false),
    [font, setFont] = useState(22),
    [paste, setPaste] = useState(false),
    [draft, setDraft] = useState(""),
    [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [password, setPassword] = useState(""),
    [range, setRange] = useState(""),
    [page, setPage] = useState(1),
    [columns, setColumns] = useState(1),
    [selection, setSelection] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [pdfName, setPdfName] = useState(""),
    [pdfCount, setPdfCount] = useState(0);
  const [glyphs, setGlyphs] = useState<Record<number, Glyph[]>>({});
  const pdfRef = useRef<PDFDocumentLoadingTask | null>(null);
  const cancel = useRef(false);
  const loadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    listMaterials()
      .then(setLibrary)
      .catch(() =>
        setError(
          "브라우저 저장소를 열 수 없습니다. 비공개 모드를 해제하거나 브라우저 저장 공간을 확인해 주세요.",
        ),
      )
      .finally(() => setReady(true));
    Promise.resolve().then(() => {
      try {
        const d = localStorage.getItem("dudada-theme") === "dark";
        setDark(d);
        document.documentElement.dataset.theme = d ? "dark" : "light";
      } catch {
        /* Theme preference is optional. */
      }
    });
    return () => {
      cancel.current = true;
      void pdfRef.current?.destroy();
    };
  }, []);
  function theme() {
    const d = !dark;
    setDark(d);
    document.documentElement.dataset.theme = d ? "dark" : "light";
    try {
      localStorage.setItem("dudada-theme", d ? "dark" : "light");
    } catch {
      /* Keep the in-memory preference. */
    }
  }
  function persist(m: Material) {
    const revision = ++saveRevision.current;
    setCurrent(m);
    setLibrary((prev) =>
      [m, ...prev.filter((x) => x.id !== m.id)].sort((a, b) =>
        b.updated.localeCompare(a.updated),
      ),
    );
    setStatus("저장 중…");
    saveQueue.current = saveQueue.current
      .then(() => saveMaterial(m))
      .then(() => {
        if (revision === saveRevision.current)
          setStatus("이 브라우저에 저장됨");
      })
      .catch(() => {
        setStatus("저장 실패");
        setError(
          "저장 공간이 부족하거나 저장소 접근이 차단됐습니다. 텍스트를 내려받아 보관하고 브라우저 설정을 확인해 주세요.",
        );
      });
  }
  function update(m: Material) {
    persist({ ...m, updated: new Date().toISOString() });
  }
  function editText(text: string) {
    if (!current) return;
    update({
      ...current,
      pages: current.pages.map((p) => (p.number === page ? { ...p, text } : p)),
      records: {},
      cursor: 0,
    });
  }
  async function loadFile(f: File) {
    setError("");
    setFile(f);
    if (f.name.toLowerCase().endsWith(".txt")) {
      try {
        if (f.size > 10 * 1024 * 1024)
          throw new Error("TXT는 10MB 이하로 나눠 주세요.");
        const m = createMaterial(
          f.name.replace(/\.txt$/i, ""),
          [{ number: 1, text: await f.text() }],
          f.name,
        );
        persist(m);
        setPage(1);
        setRange("1");
        setScreen("editor");
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF 또는 UTF-8 TXT 파일을 선택해 주세요.");
      return;
    }
    if (f.size > 512 * 1024 * 1024) {
      setError(
        "512MB를 넘는 PDF는 메모리 보호를 위해 열지 않습니다. 100MB 이하의 페이지 묶음으로 나눠 다시 선택해 주세요.",
      );
      return;
    }
    setBusy(true);
    setProgress(0);
    setStatus("PDF 여는 중…");
    cancel.current = false;
    try {
      await pdfRef.current?.destroy();
      pdfRef.current = null;
      setPdf(null);
      setGlyphs({});
      const result = await openPdf(f, password, setProgress, (task) => {
        loadingTask.current = task;
      });
      pdfRef.current = result.task;
      setPdf(result.document);
      setPdfName(f.name);
      setPdfCount(result.document.numPages);
      setRange(`1-${result.document.numPages}`);
      setStatus("페이지 범위를 선택한 뒤 글자를 추출해 주세요.");
    } catch (e) {
      if (cancel.current)
        setStatus("PDF 열기를 취소했습니다. 파일을 다시 선택해 주세요.");
      else setError(pdfError(e));
    } finally {
      loadingTask.current = null;
      setBusy(false);
    }
  }
  async function extract() {
    if (!pdf) return;
    let selected: number[];
    try {
      selected = parseRange(range, pdf.numPages);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    setError("");
    cancel.current = false;
    const pages = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        if (cancel.current) break;
        const n = selected[i];
        setStatus(`${n}페이지 추출 중 (${i + 1}/${selected.length})`);
        const result = await extractPage(pdf, n, columns);
        setGlyphs((prev) => ({ ...prev, [n]: result.glyphs }));
        pages.push({ number: n, text: result.text });
        setProgress(Math.round(((i + 1) / selected.length) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cancel.current) {
        setStatus("추출을 취소했습니다. 범위를 줄여 다시 시도하세요.");
        return;
      }
      const m = createMaterial(
        pdfName.replace(/\.pdf$/i, ""),
        pages,
        pdfName,
        pdfCount,
      );
      persist(m);
      setPage(pages[0].number);
      setScreen("editor");
      if (!pages.some((p) => p.text.trim()))
        setError(
          "이 PDF는 이미지로 구성되어 있어 글자 인식(OCR)이 필요합니다.",
        );
    } catch (e) {
      setError(pdfError(e));
    } finally {
      setBusy(false);
    }
  }
  function open(m: Material, view: "editor" | "practice") {
    setCurrent(m);
    setPage(m.pages[0].number);
    setRange(m.selected.join(", "));
    setSelection("");
    setScreen(view);
  }
  function start() {
    if (current && sentences(current).length) {
      setScreen("practice");
      setError("");
    } else setError("연습할 페이지를 선택하고 글자를 입력해 주세요.");
  }
  async function remove(m: Material) {
    if (!confirm(`“${m.title}” 자료와 학습기록을 삭제할까요?`)) return;
    try {
      await saveQueue.current;
      await deleteMaterial(m.id);
      setLibrary((prev) => prev.filter((x) => x.id !== m.id));
      if (current?.id === m.id) {
        setCurrent(null);
        setScreen("home");
      }
    } catch {
      setError("자료 삭제에 실패했습니다. 다시 시도해 주세요.");
    }
  }
  function exportText() {
    if (!current) return;
    const a = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob(
        [
          current.pages
            .map((p) => `[${p.number}페이지]\n${p.text}`)
            .join("\n\n"),
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    a.href = url;
    a.download = `${current.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const currentPage = current?.pages.find((p) => p.number === page);
  return (
    <div
      className="app"
      style={{ "--practice-size": `${font}px` } as React.CSSProperties}
    >
      <header className="site-header">
        <button className="brand" onClick={() => setScreen("home")}>
          <span className="brand-icon">
            <BookOpen size={25} />
          </span>
          <span>
            두다다 공부방<small>DUDADA STUDY</small>
          </span>
        </button>
        <div className="header-right">
          <span className="privacy">
            <ShieldCheck size={16} /> 나만의 브라우저 공부방
          </span>
          <label className="font-size">
            글씨{" "}
            <select
              aria-label="글씨 크기"
              value={font}
              onChange={(e) => setFont(+e.target.value)}
            >
              <option value="18">작게</option>
              <option value="22">보통</option>
              <option value="28">크게</option>
              <option value="34">아주 크게</option>
            </select>
          </label>
          <button
            className="icon"
            aria-label={dark ? "밝은 화면" : "어두운 화면"}
            onClick={theme}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
        </div>
      </header>
      <main>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="알림 닫기">
              닫기
            </button>
          </div>
        )}
        {screen === "home" && (
          <>
            <section className="hero">
              <span className="eyebrow">한 글자씩, 내 지식이 되는 시간</span>
              <h1>
                PDF를 <span>공부로</span> 바꾸세요.
              </h1>
              <p>
                읽고 지나쳤던 문장을 손끝으로 기억해요.
                <br />
                나의 학습자료로 시작하는 한국어 필사 연습.
              </p>
              <div className="steps">
                <span>01 자료 불러오기</span>
                <i>·</i>
                <span>02 글 다듬기</span>
                <i>·</i>
                <span>03 두다다, 기억하기</span>
              </div>
            </section>
            <section className="start-grid" aria-label="학습자료 불러오기">
              <div
                className="upload-card"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && e.dataTransfer.files[0])
                    void loadFile(e.dataTransfer.files[0]);
                }}
              >
                <div className="round-icon">
                  <Upload size={30} />
                </div>
                <h2>오늘 공부할 PDF가 있나요?</h2>
                <p>여기에 파일을 끌어 놓거나 아래에서 선택해 주세요.</p>
                <label className={`button primary ${busy ? "disabled" : ""}`}>
                  PDF 불러오기
                  <input
                    aria-label="PDF 파일 선택"
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.files?.[0]) void loadFile(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <small>PDF는 외부 서버에 업로드되지 않습니다.</small>
              </div>
              <div className="paste-card">
                <div className="round-icon peach">
                  <FileText size={28} />
                </div>
                <h2>암기노트도 좋아요</h2>
                <p>
                  복사한 글이나 직접 쓴 노트로
                  <br />
                  나만의 타자연습을 만들어 보세요.
                </p>
                <button onClick={() => setPaste(!paste)}>
                  텍스트 붙여넣기 <ArrowRight size={17} />
                </button>
                <label className="text-file">
                  TXT 파일 불러오기
                  <input
                    type="file"
                    aria-label="TXT 파일 선택"
                    accept=".txt,text/plain"
                    onChange={(e) => {
                      if (e.target.files?.[0]) void loadFile(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </section>
            {paste && (
              <section className="card paste-form">
                <h2>글을 붙여넣어 주세요</h2>
                <label>
                  자료 제목
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="예: 승진시험 암기노트"
                  />
                </label>
                <label>
                  학습할 글
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="여기에 글을 붙여넣으세요."
                    rows={7}
                  />
                </label>
                <button
                  className="primary"
                  disabled={!draft.trim()}
                  onClick={() => {
                    const m = createMaterial(title, [
                      { number: 1, text: draft },
                    ]);
                    persist(m);
                    setPage(1);
                    setRange("1");
                    setScreen("editor");
                  }}
                >
                  글 다듬기 <ArrowRight size={16} />
                </button>
              </section>
            )}
            {(file?.name.toLowerCase().endsWith(".pdf") || busy) && (
              <section className="card import-panel">
                <h2>{file?.name}</h2>
                {file && file.size >= 100 * 1024 * 1024 && (
                  <p className="notice">
                    100MB 이상 파일입니다. 다른 탭을 닫고 필요한 페이지만
                    선택하세요. 기기 메모리에 따라 열리지 않을 수 있습니다.
                  </p>
                )}
                <div className="row">
                  <label>
                    PDF 암호 (필요한 경우)
                    <input
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !file}
                    onClick={() => file && void loadFile(file)}
                  >
                    파일 다시 열기
                  </button>
                </div>
                {pdf && (
                  <>
                    <p>
                      총 {pdfCount}페이지 ·{" "}
                      {file && Math.round((file.size / 1024 / 1024) * 10) / 10}
                      MB
                    </p>
                    <div className="row">
                      <label>
                        추출할 페이지
                        <input
                          aria-label="추출할 페이지"
                          value={range}
                          onChange={(e) => setRange(e.target.value)}
                          placeholder="1-3, 5"
                        />
                      </label>
                      <label>
                        읽기 순서
                        <select
                          value={columns}
                          onChange={(e) => setColumns(+e.target.value)}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n === 1 ? "기본 (행 순서)" : `${n}단 · 왼쪽부터`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void extract()}
                      >
                        글자 추출하기
                      </button>
                    </div>
                  </>
                )}
                <p role="status">{status}</p>
                {busy && (
                  <>
                    <progress
                      value={progress}
                      max={100}
                      aria-label="PDF 처리 진행률"
                    />
                    <span>{progress}%</span>
                    <button
                      onClick={() => {
                        cancel.current = true;
                        void loadingTask.current?.destroy();
                      }}
                    >
                      처리 취소
                    </button>
                  </>
                )}
              </section>
            )}
            <section className="library">
              <div className="section-title">
                <div>
                  <span className="eyebrow">MY STUDY SHELF</span>
                  <h2>
                    나의 학습자료{" "}
                    <span className="count">{library.length}</span>
                  </h2>
                </div>
                <span>작은 반복이 큰 기억을 만들어요.</span>
              </div>
              {!ready ? (
                <p role="status">자료를 불러오는 중…</p>
              ) : library.length === 0 ? (
                <div className="empty">
                  <BookOpen size={30} />
                  <h3>첫 번째 공부를 시작해 볼까요?</h3>
                  <p>불러온 자료와 학습 진도가 여기에 차곡차곡 쌓여요.</p>
                </div>
              ) : (
                <div className="material-grid">
                  {library.map((m) => {
                    const all = sentences(m),
                      done = all.filter(
                        (s) => m.records[s.id]?.completed,
                      ).length;
                    return (
                      <article className="card material" key={m.id}>
                        <div className="row between">
                          <span className="tag">
                            {m.source.endsWith(".pdf") ? "PDF" : "텍스트"} ·{" "}
                            {m.pages.length}페이지
                          </span>
                          <button
                            className="icon"
                            aria-label={`${m.title} 삭제`}
                            onClick={() => void remove(m)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                        <h3>{m.title}</h3>
                        <p>
                          {new Date(m.updated).toLocaleDateString("ko-KR")} ·{" "}
                          {done}/{all.length}문장 완료
                        </p>
                        <progress max={all.length || 1} value={done} />
                        <div className="row">
                          <button
                            className="primary"
                            disabled={!all.length}
                            onClick={() => open(m, "practice")}
                          >
                            이어서 공부하기 <ArrowRight size={16} />
                          </button>
                          <button onClick={() => open(m, "editor")}>
                            편집
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
        {screen === "editor" && current && (
          <>
            <button className="back" onClick={() => setScreen("home")}>
              <ChevronLeft size={16} /> 내 공부방
            </button>
            <div className="page-heading">
              <div>
                <span className="eyebrow">STEP 02 · 글 다듬기</span>
                <h1>내가 기억할 문장만 골라요.</h1>
                <p>
                  {current.source} · 원문 총 {current.pageCount}페이지
                </p>
              </div>
              <span className="save-status" role="status">
                <Check size={15} />
                {status}
              </span>
            </div>
            <section className="card editor-toolbar">
              <label>
                자료 제목
                <input
                  value={current.title}
                  onChange={(e) =>
                    update({ ...current, title: e.target.value })
                  }
                />
              </label>
              <div className="row">
                <label>
                  연습 페이지 범위
                  <input
                    aria-label="연습 페이지 범위"
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => {
                    try {
                      const ns = parseRange(range, current.pageCount);
                      if (
                        ns.some(
                          (n) => !current.pages.find((p) => p.number === n),
                        )
                      )
                        throw new Error(
                          "추출된 페이지 안에서 선택해 주세요. 다른 페이지는 PDF를 다시 불러와 추출하세요.",
                        );
                      update({ ...current, selected: ns, cursor: 0 });
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  범위 적용
                </button>
                <label>
                  연습 모드
                  <select
                    value={current.mode}
                    onChange={(e) =>
                      update({
                        ...current,
                        mode: e.target.value as Material["mode"],
                        cursor: 0,
                      })
                    }
                  >
                    <option value="study">공부하기 편한 모드</option>
                    <option value="exact">정확히 따라 치기</option>
                  </select>
                </label>
              </div>
              <p className="hint">
                정확 모드는 줄 단위로 원문을 보존합니다. 공부 모드는
                줄바꿈·공백을 정리하고 문장으로 나눕니다. 긴 문장은 최대 160자로
                나눕니다.
              </p>
            </section>
            <div className="page-tabs" aria-label="페이지 선택">
              {current.pages.map((p) => (
                <button
                  className={page === p.number ? "active" : ""}
                  key={p.number}
                  onClick={() => {
                    setPage(p.number);
                    setSelection("");
                  }}
                >
                  {p.number}페이지{" "}
                  {current.selected.includes(p.number) && <Check size={13} />}
                </button>
              ))}
            </div>
            <section className="editor-grid">
              <div className="card source-pane">
                <h2>
                  원본 PDF <span className="tag">{page}페이지</span>
                </h2>
                {pdf && current.source === pdfName && page <= pdf.numPages ? (
                  <PdfPreview document={pdf} number={page} />
                ) : (
                  <div className="empty">
                    <FileText />
                    <p>
                      원본 PDF는 저장하지 않아요.
                      <br />
                      미리보려면 같은 파일을 다시 선택하세요.
                    </p>
                    <input
                      type="file"
                      aria-label="원본 PDF 다시 선택"
                      accept=".pdf"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.name !== current.source) {
                          setError(
                            "이 자료의 원본과 같은 이름의 PDF를 선택해 주세요.",
                          );
                          return;
                        }
                        setError("");
                        try {
                          await pdfRef.current?.destroy();
                          const r = await openPdf(f, password, () => {});
                          pdfRef.current = r.task;
                          setPdf(r.document);
                          setPdfName(f.name);
                        } catch (e) {
                          setError(pdfError(e));
                        }
                      }}
                    />
                    <label>
                      PDF 암호
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                <p className="hint">
                  자동 추출은 기사 순서가 다를 수 있어요. 원본과 비교한 뒤
                  수정해 주세요.
                </p>
              </div>
              <div className="card edit-pane">
                <div className="row between">
                  <h2>추출된 글</h2>
                  <span className="tag">직접 수정 가능</span>
                </div>
                <div className="edit-tools">
                  <button
                    onClick={() => editText(clean(currentPage?.text || ""))}
                  >
                    줄바꿈·공백 정리
                  </button>
                  <button
                    onClick={() => {
                      const term = prompt(
                        "모든 페이지에서 삭제할 머리말·꼬리말 문구를 입력하세요. (일치하는 글만 삭제)",
                      );
                      if (term)
                        update({
                          ...current,
                          pages: current.pages.map((p) => ({
                            ...p,
                            text: p.text.split(term).join(""),
                          })),
                          records: {},
                          cursor: 0,
                        });
                    }}
                  >
                    반복 문구 삭제
                  </button>
                  {glyphs[page] && current.source === pdfName && (
                    <label>
                      단 정렬
                      <select
                        aria-label="현재 페이지 단 정렬"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value)
                            editText(
                              readingOrder(glyphs[page], +e.target.value),
                            );
                        }}
                      >
                        <option value="">선택</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}단
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <label className="sr-only" htmlFor="page-text">
                  {page}페이지 텍스트
                </label>
                <textarea
                  id="page-text"
                  ref={editor}
                  value={currentPage?.text || ""}
                  onChange={(e) => editText(e.target.value)}
                  onSelect={(e) => {
                    const el = e.currentTarget;
                    setSelection(
                      el.value.slice(el.selectionStart, el.selectionEnd),
                    );
                  }}
                  rows={17}
                  placeholder="텍스트가 없으면 직접 입력하거나 다른 자료의 글을 붙여넣어 주세요."
                />
                {!currentPage?.text.trim() && (
                  <div className="notice">
                    이 PDF는 이미지로 구성되어 있어 글자 인식(OCR)이 필요합니다.
                    <br />
                    <button disabled>한국어·영어 OCR (후속 지원 예정)</button>
                    <p>
                      현재는 텍스트를 직접 붙여넣거나 기기의 글자 인식 결과를
                      복사해 주세요.
                    </p>
                  </div>
                )}
                <p className="hint">
                  글을 수정하면 기존 타자 기록이 초기화됩니다. 빈 줄로 문단을
                  구분하고, 일부를 드래그해 별도 자료로 만들 수 있어요.
                </p>
                <button
                  disabled={!selection.trim()}
                  onClick={() => {
                    const m = createMaterial(
                      `${current.title} · 선택한 글`,
                      [{ number: page, text: selection }],
                      current.source,
                      current.pageCount,
                    );
                    persist(m);
                    setRange(String(page));
                    setSelection("");
                  }}
                >
                  선택한 글만 새 자료로 만들기
                </button>
                <details>
                  <summary>문단 순서 바꾸기</summary>
                  {(currentPage?.text || "")
                    .split(/\n\s*\n/)
                    .map((block, i, blocks) => (
                      <div className="paragraph" key={i}>
                        <span>{block.slice(0, 65) || "(빈 문단)"}</span>
                        <button
                          aria-label={`${i + 1}문단 위로`}
                          disabled={i === 0}
                          onClick={() => {
                            const reordered = [...blocks];
                            [reordered[i - 1], reordered[i]] = [
                              reordered[i],
                              reordered[i - 1],
                            ];
                            editText(reordered.join("\n\n"));
                          }}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${i + 1}문단 아래로`}
                          disabled={i === blocks.length - 1}
                          onClick={() => {
                            const reordered = [...blocks];
                            [reordered[i + 1], reordered[i]] = [
                              reordered[i],
                              reordered[i + 1],
                            ];
                            editText(reordered.join("\n\n"));
                          }}
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                </details>
              </div>
            </section>
            <div className="editor-bottom">
              <button onClick={exportText}>
                <Download size={17} /> 텍스트 내려받기
              </button>
              <button onClick={() => update(current)}>학습자료 저장</button>
              <button className="primary" onClick={start}>
                타자연습 시작 <Keyboard size={18} />
              </button>
            </div>
          </>
        )}
        {screen === "practice" && current && (
          <Practice
            key={current.id}
            material={current}
            onUpdate={update}
            onBack={() => setScreen("editor")}
            onHome={() => setScreen("home")}
            status={status}
          />
        )}
      </main>
      <footer>
        <BookOpen size={16} />
        <span>두다다 공부방</span>
        <span>오늘도 한 문장만큼 자랐어요.</span>
        <small>
          자료는 이 기기의 브라우저에만 저장됩니다. 브라우저 데이터 삭제 시
          자료도 지워집니다.
        </small>
      </footer>
    </div>
  );
}
