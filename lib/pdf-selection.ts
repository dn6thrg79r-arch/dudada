/*
 * Adapted from PDF.js TextLayerBuilder's endOfContent selection guard.
 * Copyright Mozilla Foundation, Apache-2.0 (public/pdfjs/LICENSE).
 * https://github.com/mozilla/pdf.js/blob/v6.5.438/web/text_layer_builder.js
 */
export function bindPdfSelection(layer: HTMLDivElement) {
  const doc = layer.ownerDocument;
  const end = doc.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let pointerDown = false;
  let previous: Range | undefined;
  // Safari and older Chromium can resolve whitespace to the end of the DOM
  // rather than the text under the pointer. Place the empty guard beside the
  // moving selection endpoint, as the upstream PDF viewer does.
  const chromium = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  const nativeSelectionFixed =
    getComputedStyle(end).getPropertyValue("-moz-user-select") === "none" ||
    (chromium !== undefined && Number(chromium) >= 148);
  const needsGuard = !nativeSelectionFixed;
  const reset = () => {
    layer.append(end);
    end.style.width = "";
    end.style.height = "";
    end.style.userSelect = "";
    end.style.webkitUserSelect = "";
    layer.classList.remove("selecting");
    previous = undefined;
  };
  doc.addEventListener(
    "pointerdown",
    (event) => {
      pointerDown = layer.contains(event.target as Node);
      if (pointerDown) layer.classList.add("selecting");
    },
    options,
  );
  doc.addEventListener(
    "pointerup",
    () => {
      pointerDown = false;
      reset();
    },
    options,
  );
  doc.addEventListener(
    "pointercancel",
    () => {
      pointerDown = false;
      reset();
    },
    options,
  );
  doc.defaultView?.addEventListener(
    "blur",
    () => {
      pointerDown = false;
      reset();
    },
    options,
  );
  doc.addEventListener(
    "keyup",
    () => {
      if (!pointerDown) reset();
    },
    options,
  );
  doc.addEventListener(
    "selectionchange",
    () => {
      const selection = doc.getSelection();
      if (!selection?.rangeCount) {
        reset();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!range.intersectsNode(layer) || (range.collapsed && !pointerDown)) {
        reset();
        return;
      }
      layer.classList.add("selecting");
      if (!needsGuard) return;
      // Do not interfere with the editor's selection or keyboard shortcuts.
      if (
        !layer.contains(range.startContainer) ||
        !layer.contains(range.endContainer)
      )
        return;
      const modifyStart =
        previous &&
        (range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, previous) === 0);
      let anchor: Node | null = modifyStart
        ? range.startContainer
        : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (!modifyStart && range.endOffset === 0) {
        // Find the preceding text element, but never walk out of this PDF page.
        while (anchor && anchor !== layer) {
          if (anchor.previousSibling) {
            anchor = anchor.previousSibling;
            while (anchor.lastChild) anchor = anchor.lastChild;
            if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
            break;
          }
          anchor = anchor.parentNode;
        }
      }
      if (
        anchor &&
        anchor !== end &&
        anchor !== layer &&
        layer.contains(anchor)
      ) {
        end.style.width = layer.style.width;
        end.style.height = layer.style.height;
        end.style.userSelect = "text";
        end.style.webkitUserSelect = "text";
        anchor.parentNode!.insertBefore(
          end,
          modifyStart ? anchor : anchor.nextSibling,
        );
      }
      previous = range.cloneRange();
    },
    options,
  );
  return () => {
    controller.abort();
    end.remove();
    layer.classList.remove("selecting");
  };
}
