// src/toast.js — a short note at the bottom of the screen ("Downloaded “Dune”
// — it plays offline now"). One at a time: a new one replaces the last.
import { useEffect, useState } from "react";

const SHOW_MS = 4000;
let current = null; // { text, id }
let timer = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener(current));
}

export function showToast(text) {
  current = { text, id: Date.now() };
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, SHOW_MS);
}

export function useToast() {
  const [toast, setToast] = useState(current);
  useEffect(() => {
    listeners.add(setToast);
    return () => listeners.delete(setToast);
  }, []);
  return toast;
}
