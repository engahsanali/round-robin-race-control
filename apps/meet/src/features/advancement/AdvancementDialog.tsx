import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AdvancementDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const node = panel.current;
    const outside = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(node));
    const previous = outside.map((element) => [element, element.inert] as const);
    outside.forEach((element) => { element.inert = true; });
    const focusable = () => [...(node?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0]; const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); previous.forEach(([element, inert]) => { element.inert = inert; }); returnFocus.current?.focus(); };
  }, [onClose]);
  return createPortal(<div className="dialog-backdrop"><div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="workbook-dialog advancement-dialog"><div className="dialog-title"><h2 id={titleId}>{title}</h2><button type="button" className="quiet-action" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</div></div>, document.body);
}
