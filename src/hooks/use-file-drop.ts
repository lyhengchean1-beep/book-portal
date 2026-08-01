"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Whole-page file drop. Returns whether a file is currently being dragged over
 * the window; calls onFile once with the first file dropped.
 *
 * Three things make this fiddlier than it looks:
 *
 * - dragenter and dragleave fire for every element the pointer crosses, so
 *   moving onto a child looks identical to leaving the window. Counting enters
 *   against leaves is the only reliable way to tell them apart.
 * - Without preventDefault on dragover, the browser navigates away and opens
 *   the PDF instead of handing it to the page.
 * - dragend does not fire when the drop lands outside the window, which leaves
 *   the overlay stuck on. Blur and Escape are the escape hatches.
 */
export function useFileDrop(onFile: (file: File) => void) {
  const [dragging, setDragging] = useState(false);

  // Held in a ref so the listeners below are registered exactly once, instead
  // of being torn down and rebound on every keystroke in the form.
  const handler = useRef(onFile);
  handler.current = onFile;

  useEffect(() => {
    let depth = 0;

    const carriesFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const reset = () => {
      depth = 0;
      setDragging(false);
    };

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth += 1;
      setDragging(true);
    };

    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth -= 1;
      if (depth <= 0) reset();
    };

    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      reset();
      const file = e.dataTransfer?.files?.[0];
      if (file) handler.current(file);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return dragging;
}
