"use client";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Upload,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize,
  Expand,
  Minimize,
  Download,
  Save,
  Settings,
  Sun,
  Moon,
  FolderOpen,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import {
  createNotebook,
  turnPage,
  matchesPdf,
  clamp,
  exportNotebook,
  SaveQueue,
  type Notebook,
} from "@/lib/notebook";
import { listNotebooks, saveNotebook } from "@/lib/storage";
import type { StudyRepository } from "@/lib/repository";
const localRepository: StudyRepository = { listNotebooks, saveNotebook };
import { openPdf, pdfError } from "@/lib/pdf";
import PdfPreview from "./pdf-preview";
import Editor from "./transcription-editor";
import { useFocusMode } from "./use-focus-mode";
export default function StudyApp({
  repository = localRepository,
  accountName,
  onLogout,
}: {
  repository?: StudyRepository;
  accountName?: string;
  onLogout?: () => Promise<void>;
}) {
  const [importRevision, setImportRevision] = useState(0);
  const [pdfReload, setPdfReload] = useState(0);
  const [englishWords, setEnglishWords] = useState<string[]>([]);
  const [note, setNote] = useState<Notebook | null>(null),
    [shelf, setShelf] = useState<Notebook[]>([]),
    [ready, setReady] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [attached, setAttached] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [settings, setSettings] = useState(false),
    [library, setLibrary] = useState(false),
    [mobileTab, setMobileTab] = useState<"pdf" | "editor">("pdf"),
    [dark, setDark] = useState(false),
    [password, setPassword] = useState(""),
    [retryFile, setRetryFile] = useState<File | null>(null);
  // Keep IME guards in event handlers; disabled toggles flash the toolbar per syllable.
  const composing = useRef(false);
  const shell = useRef<HTMLDivElement>(null);
  const {
    focusMode,
    enter: enterFocus,
    exit: exitFocus,
  } = useFocusMode(shell, composing);
  const attachedId = useRef<string | null>(null);
  const failedSaves = useRef(new Set<string>());
  const current = useRef<Notebook | null>(null),
    queue = useRef<SaveQueue<Notebook> | null>(null),
    task = useRef<PDFDocumentLoadingTask | null>(null),
    loading = useRef<PDFDocumentLoadingTask | null>(null),
    dirty = useRef(false),
    opening = useRef(false),
    pdfSaving = useRef(false),
    reconnect = useRef(false);
  const picker = useRef<HTMLInputElement>(null),
    split = useRef<HTMLDivElement>(null),
    pdfScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    queue.current = new SaveQueue(
      async (snapshot) => {
        try {
          await repository.saveNotebook(snapshot);
          failedSaves.current.delete(snapshot.id);
        } catch (e) {
          failedSaves.current.add(snapshot.id);
          setError(
            `“${snapshot.title}” 저장에 실패했습니다. ${e instanceof Error ? e.message : "네트워크와 저장 공간을 확인해 주세요."} 내보내기로 글을 보관할 수 있습니다.`,
          );
          throw e;
        }
      },
      (state) => {
        dirty.current = state !== "saved" || failedSaves.current.size > 0;
        setSave(state);
      },
      repository.savePdf ? (snapshot) => snapshot.id : undefined,
    );
    let live = true;
    repository
      .listNotebooks()
      .then((notes) => {
        if (!live) return;
        setShelf(notes);
        if (notes[0]) {
          current.current = notes[0];
          setNote(notes[0]);
          setSave("saved");
        }
      })
      .catch((e) => {
        if (live) {
          setSave("error");
          setError(
            e instanceof Error
              ? e.message
              : "저장소를 열 수 없습니다. 네트워크와 브라우저 저장소 설정을 확인해 주세요.",
          );
        }
      })
      .finally(() => {
        if (live) setReady(true);
      });
    Promise.resolve().then(() => {
      try {
        const d = localStorage.getItem("dudada-theme") === "dark";
        setDark(d);
        document.documentElement.dataset.theme = d ? "dark" : "light";
      } catch {}
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current || pdfSaving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      live = false;
      window.removeEventListener("beforeunload", warn);
      void task.current?.destroy();
      void loading.current?.destroy();
    };
  }, [repository]);
  const noteId = note?.id;
  useEffect(() => {
    const target = current.current;
    if (!target || !repository.loadPdf || attachedId.current === target.id)
      return;
    let cancelled = false;
    let savedFile: File | null = null;
    repository
      .loadPdf(target)
      .then(async (file) => {
        if (!file || cancelled) return;
        savedFile = file;
        const opened = await openPdf(file, "", () => {});
        if (cancelled || current.current?.id !== target.id) {
          await opened.task.destroy();
          return;
        }
        const old = task.current;
        task.current = opened.task;
        attachedId.current = target.id;
        setPdf(opened.document);
        setAttached(target.id);
        void old?.destroy();
      })
      .catch((e) => {
        if (!cancelled) {
          if (
            savedFile &&
            (e as { name?: string }).name === "PasswordException"
          ) {
            setRetryFile(savedFile);
            reconnect.current = true;
          }
          setError(
            `저장된 PDF를 열지 못했습니다. 암호가 있는 PDF는 원본을 다시 선택하고 PDF 암호를 입력해 주세요. ${e instanceof Error ? e.message : ""}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, repository, pdfReload]);
  function update(change: Partial<Notebook>) {
    if (
      composing.current &&
      (change.editorPage !== undefined || change.pdfPage !== undefined)
    )
      return;
    const previous = current.current;
    if (!previous) return;
    const next = { ...previous, ...change, updated: new Date().toISOString() };
    current.current = next;
    void repository
      .stageNotebook?.(next)
      .catch(() =>
        setError(
          "이 기기의 임시 저장에 실패했습니다. 클라우드 저장 상태를 확인하고 중요한 글은 내보내기로 보관하세요.",
        ),
      );
    setNote(next);
    setShelf((prev) => [next, ...prev.filter((n) => n.id !== next.id)]);
    void queue.current?.enqueue(next);
  }
  function activate(next: Notebook) {
    if (current.current?.id !== next.id) setEnglishWords([]);
    current.current = next;
    void repository
      .stageNotebook?.(next)
      .catch(() =>
        setError(
          "이 기기의 임시 저장에 실패했습니다. 클라우드 저장 상태를 확인하고 중요한 글은 내보내기로 보관하세요.",
        ),
      );
    setNote(next);
    setShelf((prev) => [next, ...prev.filter((n) => n.id !== next.id)]);
    void queue.current?.enqueue(next);
  }
  function theme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("dudada-theme", next ? "dark" : "light");
    } catch {}
  }
  function choose(relink = false) {
    if (composing.current) return;
    reconnect.current = relink;
    picker.current?.click();
  }
  async function load(file: File) {
    if (opening.current) return;
    if (!/\.pdf$/i.test(file.name)) {
      setError("PDF 파일을 선택해 주세요.");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      setError(
        "512MB를 넘는 PDF는 메모리 보호를 위해 열지 않습니다. 작은 페이지 묶음으로 나눠 다시 선택해 주세요.",
      );
      return;
    }
    opening.current = true;
    setBusy(true);
    setProgress(0);
    setError("");
    setRetryFile(file);
    let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
    try {
      opened = await openPdf(file, password, setProgress, (t) => {
        loading.current = t;
      });
      const doc = opened.document;
      const fingerprint = doc.fingerprints[0] || "";
      const existing = current.current;
      if (
        reconnect.current &&
        existing &&
        !matchesPdf(existing, file.name, file.size, fingerprint, doc.numPages)
      ) {
        await opened.task.destroy();
        opened = null;
        throw new Error(
          "연결할 PDF가 원래 자료와 다릅니다. 원본 파일을 선택하거나 “PDF 불러오기”로 새 자료를 만드세요.",
        );
      }
      const match = reconnect.current
        ? existing
        : existing &&
            matchesPdf(
              existing,
              file.name,
              file.size,
              fingerprint,
              doc.numPages,
            )
          ? existing
          : shelf.find((n) =>
              matchesPdf(n, file.name, file.size, fingerprint, doc.numPages),
            );
      const next = match
        ? { ...match, fingerprint, fileSize: file.size }
        : createNotebook(file.name, doc.numPages, fingerprint, file.size);
      if (!next) throw new Error("연결할 필사 자료를 선택해 주세요.");
      if (repository.savePdf && !match) await repository.saveNotebook(next);
      const old = task.current;
      task.current = opened.task;
      attachedId.current = next.id;
      setPdf(doc);
      setAttached(next.id);
      activate(next);
      void old?.destroy();
      if (repository.savePdf) {
        pdfSaving.current = true;
        setProgress(0);
        await repository.savePdf(next, file, setProgress);
      }
      setProgress(100);
      setPassword("");
      setRetryFile(null);
      setMobileTab("pdf");
    } catch (e) {
      if (opened && task.current !== opened.task) await opened.task.destroy();
      setError(
        e instanceof Error && e.message.startsWith("연결할")
          ? e.message
          : pdfError(e),
      );
    } finally {
      loading.current = null;
      pdfSaving.current = false;
      opening.current = false;
      setBusy(false);
    }
  }
  function navigate(page: number) {
    if (composing.current) return;
    const n = current.current;
    if (!n) return;
    setEnglishWords([]);
    update(turnPage(n, page));
    pdfScroll.current?.scrollTo({ top: 0, left: 0 });
  }
  function download(markdown = false, text?: string) {
    const n = current.current;
    if (!n) return;
    const url = URL.createObjectURL(
      new Blob([text ?? exportNotebook(n, markdown)], {
        type: markdown
          ? "text/markdown;charset=utf-8"
          : "text/plain;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${n.title}${text ? "_이전편집글" : ""}.${markdown ? "md" : "txt"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function resize(clientX: number) {
    const box = split.current?.getBoundingClientRect();
    if (box)
      update({
        split: clamp(((clientX - box.left) / box.width) * 100, 25, 75),
      });
  }
  const connected = !!note && attached === note.id && !!pdf;
  return (
    <div ref={shell} className={`study-shell${focusMode ? " is-focused" : ""}`}>
      {focusMode && (
        <button
          className="exit-focus"
          aria-label="전체화면 나가기"
          title="전체화면 나가기 (Esc)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={exitFocus}
        >
          <Minimize size={18} />
        </button>
      )}
      <input
        className="sr-only"
        ref={picker}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="PDF 파일 선택"
        disabled={!ready || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void load(file);
          e.target.value = "";
        }}
      />
      <header className="app-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <span>
            두다다 공부방<small>PDF 필사 공부방</small>
          </span>
        </a>
        <div className="header-actions">
          <button
            className="focus-toggle"
            aria-label="전체화면"
            aria-pressed={focusMode}
            title="PDF와 필사만 보기"
            disabled={!note}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSettings(false);
              setLibrary(false);
              enterFocus();
            }}
          >
            <Expand size={17} />
            <span>전체화면</span>
          </button>
          <button
            disabled={!ready || busy}
            className="primary"
            onClick={() => choose()}
          >
            <Upload size={16} />
            <span>PDF 불러오기</span>
          </button>
          <button
            aria-label="내 필사 자료"
            aria-expanded={library}
            onClick={() => setLibrary(!library)}
            disabled={!ready}
          >
            <FolderOpen size={18} />
          </button>
          {onLogout && (
            <>
              <span className="account-name">{accountName}</span>
              <button
                disabled={busy}
                onClick={async () => {
                  await queue.current?.flush();
                  if (
                    dirty.current &&
                    !confirm(
                      "저장하지 못한 글이 있습니다. TXT로 보관하지 않고 로그아웃할까요?",
                    )
                  )
                    return;
                  try {
                    await onLogout();
                  } catch {
                    setError(
                      "로그아웃에 실패했습니다. 연결을 확인하고 다시 시도해 주세요.",
                    );
                  }
                }}
              >
                로그아웃
              </button>
            </>
          )}
          <button
            aria-label="설정"
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button aria-label="오류 닫기" onClick={() => setError("")}>
            닫기
          </button>
        </div>
      )}
      {save === "error" && (
        <div className="notice error" role="alert">
          자동 저장에 실패했습니다. 이 화면의 글은 남아 있습니다. 닫기 전에
          내보내기로 보관하고, 저장 공간·사이트 저장소 설정을 확인하세요.
          <button
            onClick={() =>
              current.current && void queue.current?.enqueue(current.current)
            }
          >
            저장 재시도
          </button>
          <button onClick={() => download()}>TXT 내보내기</button>
        </div>
      )}
      {busy && (
        <div className="loading-bar" role="status">
          <span>PDF 불러오기·저장 중 · {progress}%</span>
          <progress max="100" value={progress} />
          <button onClick={() => void loading.current?.destroy()}>취소</button>
        </div>
      )}
      {retryFile && !busy && (
        <form
          className="password-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void load(retryFile);
          }}
        >
          <span>{retryFile.name}</span>
          <label>
            PDF 암호
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit">다시 열기</button>
          <button type="button" onClick={() => setRetryFile(null)}>
            취소
          </button>
        </form>
      )}
      {library && (
        <section className="drawer" aria-label="저장된 필사 자료">
          <div className="section-heading">
            <h2>내 필사 자료</h2>
            <button onClick={() => setLibrary(false)}>닫기</button>
          </div>
          {shelf.length ? (
            shelf.map((n) => (
              <button
                className="shelf-item"
                key={n.id}
                disabled={busy}
                onClick={() => {
                  activate(n);
                  setLibrary(false);
                }}
              >
                <BookOpen size={19} />
                <span>
                  {n.title}
                  <small>
                    {n.pageCount}페이지 ·{" "}
                    {new Date(n.updated).toLocaleDateString("ko-KR")}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <p>PDF를 불러오면 필사 자료가 여기에 저장됩니다.</p>
          )}
        </section>
      )}
      {settings && (
        <section className="settings-panel" aria-label="공부방 설정">
          <label>
            자료 이름
            <input
              value={note?.title || ""}
              disabled={!note}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label>
            편집기 글씨 크기
            <select
              aria-label="편집기 글씨 크기"
              value={note?.fontSize || 19}
              disabled={!note}
              onChange={(e) => update({ fontSize: +e.target.value })}
            >
              {[16, 19, 22, 26, 30].map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={note?.followPage ?? true}
              disabled={!note}
              onChange={(e) =>
                update({
                  followPage: e.target.checked,
                  ...(e.target.checked ? { editorPage: note!.pdfPage } : {}),
                })
              }
            />{" "}
            PDF 페이지에 맞춰 필사 전환
          </label>
          <button onClick={theme}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}{" "}
            {dark ? "밝은 화면" : "다크 모드"}
          </button>
          {repository.savePdf && (
            <button
              onClick={async () => {
                if (
                  !confirm(
                    "이 브라우저에 남아 있는 이전 필사를 현재 계정에 복사할까요? 원본 PDF는 한 번 다시 선택해야 합니다.",
                  )
                )
                  return;
                try {
                  const previous = await listNotebooks();
                  for (const original of previous) {
                    const copy = {
                      ...original,
                      id: crypto.randomUUID(),
                      updated: new Date().toISOString(),
                    };
                    await repository.saveNotebook(copy);
                    setShelf((prev) => [copy, ...prev]);
                  }
                  setSettings(false);
                } catch {
                  setError(
                    "이전 필사를 가져오지 못했습니다. 기존 자료는 삭제하지 않았습니다.",
                  );
                }
              }}
            >
              이전 브라우저 필사 가져오기
            </button>
          )}
          {repository.deletePdf && note && (
            <button
              onClick={async () => {
                if (
                  !confirm(
                    "이 자료의 저장된 PDF만 삭제할까요? 필사 글은 남습니다.",
                  )
                )
                  return;
                try {
                  await repository.deletePdf!(note);
                  await task.current?.destroy();
                  task.current = null;
                  attachedId.current = null;
                  setEnglishWords([]);
                  setPdf(null);
                  setAttached(null);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "삭제에 실패했습니다.",
                  );
                }
              }}
            >
              저장된 PDF 삭제
            </button>
          )}
          {note?.legacyText && (
            <button onClick={() => download(false, note.legacyText)}>
              이전 버전 편집 글 내려받기
            </button>
          )}
          <button onClick={() => setSettings(false)}>닫기</button>
        </section>
      )}
      {note ? (
        <>
          <div className="document-toolbar">
            <div className="document-name" title={note.fileName}>
              <FileMark />
              <span>{note.fileName}</span>
            </div>
            <div className="page-controls">
              <button
                aria-label="이전 페이지"
                disabled={note.pdfPage <= 1}
                onClick={() => navigate(note.pdfPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <label className="page-number">
                <span className="sr-only">현재 PDF 페이지</span>
                <select
                  aria-label="현재 PDF 페이지"
                  value={note.pdfPage}
                  onChange={(e) => navigate(+e.target.value)}
                >
                  {Array.from({ length: note.pageCount }, (_, i) => (
                    <option value={i + 1} key={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <span>/ {note.pageCount}</span>
              </label>
              <button
                aria-label="다음 페이지"
                disabled={note.pdfPage >= note.pageCount}
                onClick={() => navigate(note.pdfPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div
              className="zoom-controls"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("button"))
                  e.preventDefault();
              }}
            >
              <button
                aria-label="PDF 축소"
                onClick={() =>
                  update({
                    zoom: clamp(
                      (typeof note.zoom === "number" ? note.zoom : 100) - 25,
                      50,
                      300,
                    ),
                  })
                }
              >
                <Minus size={16} />
              </button>
              <select
                aria-label="PDF 확대 비율"
                value={note.zoom}
                onChange={(e) =>
                  update({
                    zoom: e.target.value === "fit" ? "fit" : +e.target.value,
                  })
                }
              >
                <option value="fit">너비 맞춤</option>
                {[50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300].map(
                  (n) => (
                    <option value={n} key={n}>
                      {n}%
                    </option>
                  ),
                )}
              </select>
              <button
                aria-label="PDF 확대"
                onClick={() =>
                  update({
                    zoom: clamp(
                      (typeof note.zoom === "number" ? note.zoom : 100) + 25,
                      50,
                      300,
                    ),
                  })
                }
              >
                <Plus size={16} />
              </button>
              <button
                aria-label="PDF 화면 너비에 맞추기"
                onClick={() => update({ zoom: "fit" })}
              >
                <Maximize size={16} />
              </button>
            </div>
            <div
              className={`save-state${save === "error" ? " error" : ""}`}
              data-save-state={save}
              role="status"
              aria-live="off"
              title={
                save === "saved"
                  ? "자동 저장됨"
                  : save === "saving"
                    ? "저장 중…"
                    : save === "error"
                      ? "저장 실패"
                      : "저장 준비 중"
              }
            >
              <Save size={13} aria-hidden="true" />
              <span>{save === "error" ? "저장 실패" : "자동 저장"}</span>
              <span className="sr-only">
                {save === "saved"
                  ? "자동 저장됨"
                  : save === "saving"
                    ? "저장 중…"
                    : save === "idle"
                      ? "저장 준비 중"
                      : ""}
              </span>
            </div>
            <details className="export-menu">
              <summary>
                <Download size={15} /> 내보내기
              </summary>
              <div>
                <button onClick={() => download()}>모든 페이지 TXT</button>
                <button onClick={() => download(true)}>
                  모든 페이지 Markdown
                </button>
              </div>
            </details>
          </div>
          <nav className="mobile-tabs" aria-label="공부 화면">
            <button
              className={mobileTab === "pdf" ? "active" : ""}
              onClick={() => setMobileTab("pdf")}
            >
              PDF 보기
            </button>
            <button
              className={mobileTab === "editor" ? "active" : ""}
              onClick={() => setMobileTab("editor")}
            >
              필사하기
            </button>
          </nav>
          <main
            ref={split}
            className={`split-workspace tab-${mobileTab}`}
            style={{ "--pdf-share": `${note.split}%` } as React.CSSProperties}
          >
            <section className="pdf-pane" aria-label="PDF 뷰어">
              {focusMode && (
                <nav
                  className="focus-page-controls"
                  aria-label="전체화면 페이지 이동"
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest("button"))
                      e.preventDefault();
                  }}
                >
                  <button
                    aria-label="이전 페이지"
                    title="이전 페이지"
                    disabled={note.pdfPage <= 1}
                    onClick={() => navigate(note.pdfPage - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span aria-label="전체화면 현재 페이지">
                    {note.pdfPage} / {note.pageCount}
                  </span>
                  <button
                    aria-label="다음 페이지"
                    title="다음 페이지"
                    disabled={note.pdfPage >= note.pageCount}
                    onClick={() => navigate(note.pdfPage + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </nav>
              )}
              <div className="pane-heading">
                <span>원본 읽기</span>
                <small>
                  {note.pdfPage}페이지{" "}
                  {note.fileSize && note.fileSize >= 100 * 1024 * 1024
                    ? " · 대용량 파일, 필요한 페이지만 표시해요"
                    : ""}
                </small>
              </div>
              <div
                ref={pdfScroll}
                className="pdf-scroll"
                tabIndex={0}
                aria-label="PDF 스크롤 영역"
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).tagName === "CANVAS")
                    e.preventDefault();
                }}
              >
                {connected ? (
                  <PdfPreview
                    document={pdf!}
                    number={note.pdfPage}
                    zoom={note.zoom}
                    onEnglishWords={setEnglishWords}
                  />
                ) : (
                  <div className="reconnect">
                    <BookOpen size={40} />
                    <h2>필사는 그대로 남아 있어요.</h2>
                    <p>
                      원본 PDF를 다시 선택하면
                      <br />
                      이어서 읽을 수 있어요.
                    </p>
                    {repository.loadPdf && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          attachedId.current = null;
                          setEnglishWords([]);
                          setPdfReload((v) => v + 1);
                        }}
                      >
                        저장된 PDF 다시 불러오기
                      </button>
                    )}
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => choose(true)}
                    >
                      원본 PDF 다시 연결
                    </button>
                    <small>
                      {repository.savePdf
                        ? "PDF가 저장되지 않았거나 연결에 실패했습니다. 원본을 선택하면 다시 저장합니다."
                        : "PDF 원본은 자동 저장하지 않습니다."}
                    </small>
                  </div>
                )}
              </div>
            </section>
            <div
              role="separator"
              aria-label="좌우 영역 크기 조절"
              aria-orientation="vertical"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(note.split)}
              tabIndex={0}
              className="split-handle"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  resize(e.clientX);
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  update({
                    split: clamp(
                      note.split + (e.key === "ArrowRight" ? 2 : -2),
                      25,
                      75,
                    ),
                  });
                }
              }}
            >
              <span />
            </div>
            <section className="editor-pane" aria-label="자유 필사">
              <div className="pane-heading">
                <span>
                  <PenLine size={15} /> 나의 필사
                </span>
                <div>
                  {!note.followPage && (
                    <span className="pinned">페이지 고정</span>
                  )}
                  <label>
                    <span className="sr-only">필사 페이지</span>
                    <select
                      aria-label="필사 페이지"
                      disabled={note.followPage}
                      value={note.editorPage}
                      onChange={(e) => update({ editorPage: +e.target.value })}
                    >
                      {Array.from({ length: note.pageCount }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}페이지 필사
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <Editor
                key={`${note.id}:${note.editorPage}:${importRevision}`}
                initial={note.drafts[note.editorPage] || ""}
                fontSize={note.fontSize}
                englishWords={englishWords}
                autoEnglish={note.autoEnglish ?? false}
                onAutoEnglish={(value) => update({ autoEnglish: value })}
                onComposition={(active) => {
                  composing.current = active;
                }}
                onInput={(text) => {
                  const n = current.current;
                  if (n)
                    update({ drafts: { ...n.drafts, [n.editorPage]: text } });
                }}
              />
              <div className="editor-foot">
                <span>내 속도로, 한 문장씩.</span>
                <label className="import-text">
                  필사 파일 불러오기
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    aria-label="필사 파일 불러오기"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      if (f.size > 10 * 1024 * 1024) {
                        setError("필사 파일은 10MB 이하로 나눠 주세요.");
                        return;
                      }
                      try {
                        const text = await f.text();
                        const n = current.current;
                        if (!n) return;
                        if (
                          n.drafts[n.editorPage] &&
                          !confirm(
                            "현재 페이지 필사를 불러온 파일로 바꿀까요? 내보내기로 먼저 보관할 수 있습니다.",
                          )
                        )
                          return;
                        // Replace using a new revision key only for an explicit file import.
                        update({
                          drafts: { ...n.drafts, [n.editorPage]: text },
                        });
                        setImportRevision((v) => v + 1);
                      } catch {
                        setError(
                          "필사 파일을 읽지 못했습니다. UTF-8 TXT 또는 Markdown 파일로 다시 선택해 주세요.",
                        );
                      }
                    }}
                  />
                </label>
              </div>
            </section>
          </main>
        </>
      ) : (
        <main className="welcome">
          <span className="welcome-icon">
            <BookOpen size={40} />
          </span>
          <span className="eyebrow">읽는 시간을, 나의 문장으로</span>
          <h1>읽고, 천천히 옮겨 적어요.</h1>
          <p>
            왼쪽에는 PDF 원문, 오른쪽에는 나의 필사.
            <br />내 속도로 정독하는 조용한 공부방입니다.
          </p>
          <div
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (ready && !busy && e.dataTransfer.files[0]) {
                reconnect.current = false;
                void load(e.dataTransfer.files[0]);
              }
            }}
          >
            <Upload size={26} />
            <button
              className="primary"
              disabled={!ready || busy}
              onClick={() => choose()}
            >
              PDF 불러오기
            </button>
            <small>또는 PDF 파일을 이곳에 놓아 주세요.</small>
          </div>
          <p className="local-note">
            <ShieldCheck size={15} />{" "}
            {repository.savePdf
              ? "PDF와 필사는 로그인한 계정의 비공개 공간에 저장됩니다."
              : "파일과 필사는 이 브라우저에서만 처리됩니다."}
          </p>
          {!ready && <p role="status">저장된 필사를 불러오는 중…</p>}
        </main>
      )}
    </div>
  );
}
function FileMark() {
  return <BookOpen size={16} />;
}
