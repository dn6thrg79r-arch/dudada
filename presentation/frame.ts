import { init } from "pptx-preview";
let viewer: ReturnType<typeof init> | null = null;
let key = "",
  page = 1,
  count = 0,
  naturalWidth = 960,
  viewportWidth = 960;
const root = document.getElementById("slide-root")!;
function send(type: string, extra: Record<string, unknown> = {}) {
  parent.postMessage({ type, key, page, ...extra }, "*");
}
function selection() {
  const s = getSelection();
  if (
    !s?.rangeCount ||
    s.isCollapsed ||
    !root.contains(s.anchorNode) ||
    !root.contains(s.focusNode)
  ) {
    send("selection", { selection: null });
    return;
  }
  const box = root.getBoundingClientRect();
  const rects = Array.from(s.getRangeAt(0).getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: (r.x - box.x) / box.width,
      y: (r.y - box.y) / box.height,
      width: r.width / box.width,
      height: r.height / box.height,
    }))
    .filter((r) => r.height < 0.15)
    .slice(0, 500);
  send("selection", {
    selection: { text: s.toString().slice(0, 10000), rects },
  });
}
window.addEventListener("message", async (event) => {
  if (event.source !== parent) return;
  const data = event.data;
  if (
    data?.type === "load" &&
    data.bytes instanceof ArrayBuffer &&
    data.bytes.byteLength <= 120 * 1024 * 1024
  ) {
    key = data.key;
    naturalWidth = data.width;
    viewportWidth = data.viewWidth;
    page = data.page;
    root.style.width = `${data.width}px`;
    root.style.height = `${data.height}px`;
    root.style.transform = `scale(${viewportWidth / naturalWidth})`;
    try {
      viewer?.destroy();
      viewer = init(root, {
        width: data.width,
        height: data.height,
        mode: "slide",
      });
      const deck = await viewer.load(data.bytes);
      const ordered = data.slidePaths.map((path: string) =>
        deck.slides.find((slide) => slide.name === path),
      );
      if (ordered.some((slide: unknown) => !slide) || !ordered.length)
        throw new Error("Missing slide");
      deck.slides = ordered;
      count = viewer.slideCount;
      viewer.renderSingleSlide(page - 1);
      send("rendered");
    } catch {
      send("error");
    }
  } else if (data?.key === key && viewer) {
    if (data.type === "resize" && data.width > 0) {
      viewportWidth = data.width;
      root.style.transform = `scale(${viewportWidth / naturalWidth})`;
    }
    if (
      data.type === "page" &&
      Number.isInteger(data.page) &&
      data.page >= 1 &&
      data.page <= count
    ) {
      page = data.page;
      getSelection()?.removeAllRanges();
      send("selection", { selection: null });
      try {
        viewer.renderSingleSlide(page - 1);
        send("rendered");
      } catch {
        send("error");
      }
    }
  }
});
document.addEventListener("selectionchange", () =>
  requestAnimationFrame(selection),
);
document.addEventListener("keydown", (e) => {
  if (
    e.isComposing ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    e.shiftKey ||
    (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
  )
    return;
  e.preventDefault();
  send("navigate", { delta: e.key === "ArrowRight" ? 1 : -1 });
});
parent.postMessage({ type: "ready" }, "*");
