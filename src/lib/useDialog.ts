import { useEffect, useRef } from "react";
/** Keep keyboard focus inside the open money dialog and return it on close. */
export function useDialog(open: boolean, close: () => void, locked: boolean) {
  const current = useRef({ close, locked });
  current.current = { close, locked };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[data-money-dialog]");
    if (!dialog) return;
    const elements = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      );
    if (!dialog.contains(document.activeElement)) elements()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !current.current.locked) {
        event.preventDefault();
        current.current.close();
      }
      if (event.key !== "Tab") return;
      const nodes = elements();
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [open]);
}
