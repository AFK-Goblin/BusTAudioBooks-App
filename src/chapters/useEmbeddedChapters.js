// Chapters embedded in the active part of the current book, or null while
// unknown / when the part has none. Reading happens once per part (see
// src/chapters/index.ts) and never blocks playback.
import { useEffect, useState } from "react";
import { embeddedChapters } from "./index";

export function useEmbeddedChapters(book, partIndex) {
  const key = book && book.files && book.files[partIndex] ? `${book.id}:${partIndex}` : null;
  const [state, setState] = useState({ key: null, chapters: null });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    embeddedChapters(book, partIndex)
      .then((chapters) => { if (alive) setState({ key, chapters }); })
      .catch(() => {});
    return () => { alive = false; };
    // book identity changes on every snapshot; the key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.chapters : null;
}
