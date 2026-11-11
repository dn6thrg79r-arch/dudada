"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
export function useFocusMode(
  shell: RefObject<HTMLDivElement | null>,
  composing: RefObject<boolean>,
) {
  const [focusMode, setFocusMode] = useState(false);
  const active = useRef(false),
    native = useRef(false);
  const focusEditor = useCallback(
    () =>
      shell.current
        ?.querySelector<HTMLTextAreaElement>(".manuscript")
        ?.focus({ preventScroll: true }),
    [shell],
  );
  const exit = useCallback(() => {
    active.current = false;
    setFocusMode(false);
    if (
      document.fullscreenElement === shell.current &&
      document.exitFullscreen
    ) {
      void document
        .exitFullscreen()
        .catch(() => {})
        .finally(focusEditor);
    } else focusEditor();
  }, [shell, focusEditor]);
  const enter = useCallback(() => {
    active.current = true;
    setFocusMode(true);
    const element = shell.current;
    // Hide app chrome even on Safari/iPad versions that do not support fullscreen.
    if (element?.requestFullscreen) {
      native.current = true;
      void element
        .requestFullscreen()
        .then(() => {
          if (!active.current && document.fullscreenElement === element)
            void document.exitFullscreen().catch(() => {});
          else focusEditor();
        })
        .catch(() => {
          native.current = false;
          focusEditor();
        });
    } else focusEditor();
  }, [shell, focusEditor]);
  useEffect(() => {
    const fullscreenChanged = () => {
      if (native.current && document.fullscreenElement !== shell.current) {
        native.current = false;
        active.current = false;
        setFocusMode(false);
        focusEditor();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        active.current &&
        !event.isComposing &&
        !composing.current
      ) {
        event.preventDefault();
        exit();
      }
    };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    document.addEventListener("keydown", key);
    return () => {
      active.current = false;
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      document.removeEventListener("keydown", key);
    };
  }, [shell, composing, exit, focusEditor]);
  return { focusMode, enter, exit };
}
