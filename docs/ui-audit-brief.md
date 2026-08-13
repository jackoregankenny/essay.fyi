# Overnight UI audit + polish brief

You are auditing and polishing the UI of **Essay**, a local-first desktop
writing environment (Tauri 2 + React 19 + Tiptap 3 + Tailwind 4). Work
autonomously. Produce a ranked audit first, then implement the fixes you are
confident in. The bar is **artisanal software** — iA Writer / Typora clarity
with Linear-class chrome craft.

## Ground truth — read before judging anything

1. `CLAUDE.md` — the six non-negotiable invariants (Markdown file is
   canonical; typing never blocks; fully offline; AI proposes, the author
   decides) and the project's history.
2. `docs/ui-overhaul.md` — the layout doctrine (gutter + manuscript + one
   companion slot; summoned layers) and the **"Direction shift (Jack,
   2026-08-07)"** section: dark-first deep-graphite theme, azure accent,
   floating chrome (no bars), chrome that recedes with typing flow,
   Typora-class writing clarity. The direction is settled — execute within
   it; flag direction *questions* in the report instead of deciding them.
3. `packages/theme/theme.css` — every colour, radius, weight, speed and
   easing token, with usage rules in comments. `packages/editor/prose.css` —
   the manuscript's typography and focus-mode grades.

## How to run and verify

- `bun install`; `bun run dev` serves the web preview on :3000 (Tauri
  commands no-op there — file open/save does nothing; that is expected).
- Seed a manuscript in the browser console:
  `document.querySelector('.ProseMirror').editor.commands.setContent(md, { contentType: 'markdown' })`.
  Do not simulate typing markdown — input rules do not fire for synthetic
  multi-line insertion.
- `bun run tauri dev` for the real shell when judging window chrome.
- `bun run typecheck` must pass after every change. Verify every visual
  change with a screenshot in **both** themes (dark is default; toggle
  light via the palette).

## The interrogation

Answer each of these explicitly in the report, with evidence (screenshots,
file:line references). These are the owner's own questions — do not skip any.

**Chrome and placement**
- Why is there a menu (folders icon) in the top left? Is it the file
  picker? Should file browsing live only behind ⌘K / a layer, with the top
  left reserved for the OS (macOS traffic lights)? Judge the floating
  top-left cluster's right to exist.
- Why is there all this stuff on the far right (update check, ⌘K pill,
  Structure/Proof/Agent segmented cluster)? Interrogate each control:
  what does it earn, what could move into the palette or the companion's
  own header, what is duplicated (the companion header repeats the tenant
  switcher — is that one control in two places, or two controls)?
- How does the floating chrome integrate with the actual OS window shape?
  macOS: `titleBarStyle: Overlay`, `TRAFFIC_LIGHT_INSET` (78px) in
  `lib/platform.ts` + `TopBar.tsx` — is the inset right, do the traffic
  lights sit on the same optical row as the floating controls, does the
  drag region still cover enough of the top strip now that the bar is
  gone? Windows: `WindowControls` renders its own buttons — do they clash
  with the floating cluster? Linux: server-side decorations — double
  chrome? Report what can only be verified on hardware as such.

**The status line (bottom left)**
- Words, sections, measure select, page count, save state: are they big
  enough? Right font? Enough contrast against the canvas at 11px/510 in
  both themes? Should they float in bubbles/pills instead of bare letters?
  Should they be at the bottom at all, or fade in only on pointer
  approach? Should page length appear while writing (the doctrine says
  print-awareness is first-class), not only when Proof is open?

**Primitives**
- Inventory `apps/desktop/src/components/ui/` (IconButton, tooltip,
  window-controls) against actual usage. Buttons, pills, chips, cards,
  section headers, kbd chips are hand-rolled with repeated class strings
  across TopBar, CommandPalette, FilesPanel, DiffReview, AgentPanel,
  HistoryPane — extract the 3–4 primitives that would make every surface
  consistent (QuietButton, Chip/Pill, CardRow, PaneHeading?). Check
  heights (24/28px), radii (4/6/8/12), and type sizes (10/11/12/13px)
  actually match across surfaces; list every deviation.

**Icons**
- `components/icons.tsx` is Essay's own set with strict rules in its
  header comment; Phosphor icons remain elsewhere. Audit every icon in the
  chrome: is each the right metaphor, weight-matched at 16px, and from the
  right set? Which remaining Phosphor uses should become Essay icons?

**Backgrounds and surfaces**
- Token discipline: find every hardcoded colour left (`bg-black/20`
  backdrops, any stray hex/oklch outside theme.css) and every place
  `--essay-bg` / `--essay-editor-bg` / `--essay-surface` /
  `--essay-surface-hover` is used against the token's stated role. Judge
  the glass treatments (backdrop-blur on palette/files backdrops): right
  strength? Consistent?

**Animation**
- Inventory every animation/transition against the three-speed scale and
  its rules (quick = feedback, regular = in-surface reveals, slow = whole
  layers; quint for popovers, swift for slides). Anything still snapping
  (companion close is instant unmount — should it slide out?), anything
  over-animated, anything missing `prefers-reduced-motion` handling? Are
  the layer entrances consistent (DiffReview pops via .essay-pop; FontsPage
  has nothing)? Is the typing-flow fade (`data-typing`, styles.css) tuned
  right — engages after ~1.2s of sustained typing, 0.7s out, instant back?

**Focus and keyboard**
- Focus-visible rings on every interactive element? Sensible tab order now
  that chrome floats? Every command reachable by keyboard, every shortcut
  shown in tooltips/palette rows and correctly translated on macOS
  (`shortcut()` in lib/platform.ts)? Focus mode itself: gradient grades
  (prose.css), glide centring (packages/editor `glideTo`) — does it hold
  at document top/bottom, in long paragraphs, with the selection toolbar?

**Exposure**
- Features built but buried: find options (Alt+C/Alt+W), table controls
  (appear on caret in table), image insert, checkpoint ("Mark this
  version"), prose face, writing width, History tenant (no top-bar
  segment — only palette). For each: is its current exposure deliberate
  and right, or an accident of history?

**Agents**
- How do agents integrate end to end? Open the Agent tenant: picker,
  session options strip, transcript, PROPOSAL vs ON DISK decision rows,
  diff review handoff, the waiting-dot in the top bar. Is the flow clean
  enough that "checking the agent's work" feels like reading, not
  triage? What of the designed-but-unbuilt inline presence (toolCall
  `locations`, section markers for pending proposals in the gutter)?
  Report the gap; do not build it overnight.

**The manuscript itself**
- Prose rhythm in both faces (Geist and the serif stack), both themes.
  Selection toolbar arrival and contents. Gutter + fan behaviour at scale:
  seed a 60-section document and check the tick scroller, fan overflow
  handling, and label spread. Blockquote, code block, table, task list,
  image styling — do they all feel like one designed page?

## Rules of engagement

- Branch: `ui-audit-polish`. One commit per coherent fix, in the repo's
  commit voice (descriptive sentence, no prefixes).
- Write the audit to `docs/ui-audit-findings.md`: every finding gets
  surface, problem, evidence, proposed fix, effort (S/M/L), and a
  priority rank. Findings you fixed get marked fixed; direction questions
  get marked for Jack.
- Fix order: highest-impact perceptible polish first. Do not restructure
  layout doctrine, do not add dependencies, do not touch the Rust side,
  do not weaken round-trip or perf invariants (decorations stay cheap —
  see FocusCurrentBlock's perf comment before touching it).
- Comments state design decisions in the codebase's editorial voice —
  never narrate code.
- Everything typechecks; every visual claim in the report carries a
  screenshot from the browser preview (both themes where relevant).
