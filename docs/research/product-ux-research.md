# Product and UX research

Research completed on 2026-08-13 for Round Robin Race Control.

## Decisions adopted

- Separate the dense operator cockpit from the spacious spectator/presentation view.
- Treat a semantic standings table as authoritative; charts explain gaps and trends rather than replacing the table.
- Add a direct “Why this rank?” explanation of every configured tie break.
- Make saved results produce an atomic receipt with standings impact and an undo window.
- Label results as provisional or official and never celebrate a champion before official finalization.
- Provide a rehearsal event, fairness inspector, what-if sandbox, announcer mode, spectator board, and recovery-confidence panel.
- Keep race-critical touch targets at 48–56 px even though WCAG 2.2's minimum target rule is smaller.
- Preserve download/copy fallbacks for sharing and treat browser local-file storage as best-effort rather than a guaranteed backup.

## Interaction constraints

- Standings movement lasts about 180–240 ms and leaves a persistent rank-delta label.
- Reduced-motion mode removes spatial movement and number rolling.
- Auto-rotating presentation screens expose pause, previous, next, and interval controls.
- Keyboard shortcuts never fire while editing fields; shortcuts are always discoverable.
- Data updates never move keyboard focus.
- Every chart has a title, written takeaway, and accessible data table.

## Primary sources

- [WCAG 2.2 — Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- [WCAG 2.2 — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WAI-ARIA Authoring Practices — Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)
- [MDN — localStorage file-URL behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [MDN — IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [MDN — Storage persistence](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN — Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [MDN — Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [Apache ECharts — accessibility](https://echarts.apache.org/handbook/en/best-practices/aria/)
- [Open Graph protocol](https://ogp.me/)
- [Ink & Switch — Local-first software](https://www.inkandswitch.com/essay/local-first/)
