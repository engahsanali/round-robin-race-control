import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function WorkbookDialog({ title, onClose, children, role = "dialog" }: { title: string; onClose(): void; children: ReactNode; role?: "dialog" | "alertdialog" }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [portalRoot] = useState(() => { const root = document.createElement("div"); root.dataset.workbookPortal = "true"; return root; });
  const [titleId] = useState(() => `workbook-dialog-${crypto.randomUUID()}`);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!portalRoot.isConnected) document.body.append(portalRoot);
    const inertTargets = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== portalRoot);
    const priorInert = new Map(inertTargets.map((target) => [target, { value: target.inert, attribute: target.hasAttribute("inert") }]));
    for (const target of inertTargets) { target.inert = true; target.setAttribute("inert", ""); }
    node?.querySelector<HTMLElement>("[data-initial-focus], input, select, textarea, button")?.focus();
    const focusable = () => node ? [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])')].filter((item) => !item.hasAttribute("hidden")) : [];
    const recoverFocus = () => focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (portalRoot.inert) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !node) return;
      const items = focusable(); if (!items.length) return;
      const first = items[0]!; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => { if (!portalRoot.inert && node && event.target instanceof Node && !node.contains(event.target)) recoverFocus(); };
    document.addEventListener("keydown", onKey, true); document.addEventListener("focusin", onFocus, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocus, true); for (const target of inertTargets) { const prior = priorInert.get(target); target.inert = prior?.value ?? false; if (!prior?.attribute) target.removeAttribute("inert"); } portalRoot.remove(); returnFocus.current?.focus(); };
  }, [portalRoot]);
  return createPortal(<div className="dialog-backdrop"><div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} className="workbook-dialog"><div className="dialog-title"><h2 id={titleId}>{title}</h2><button type="button" className="quiet-action" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</div></div>, portalRoot);
}
