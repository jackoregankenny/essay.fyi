import { isTauri } from '@tauri-apps/api/core'
import { CaretUpDown } from '@phosphor-icons/react'
import { cn } from '#/lib/cn'
import {
  commandKey,
  isMac,
  shortcut,
  TRAFFIC_LIGHT_INSET,
} from '#/lib/platform'
import type { CompanionTenant } from './Companion'
import {
  IconAgent,
  IconFolders,
  IconProof,
  IconStructure,
} from './icons'
import { UpdateButton } from './UpdateButton'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'
import { WindowControls } from './ui/window-controls'

export interface TopBarProps {
  docName: string
  dirty: boolean
  /** An unanswered disk conflict counts as unsaved work. */
  conflict: boolean
  tenant: CompanionTenant | null
  onToggleTenant: (tenant: CompanionTenant) => void
  filesOpen: boolean
  onToggleFiles: () => void
  onOpenPalette: () => void
  /** Agent decisions waiting on the author — the dot in the chrome. */
  waitingOnAuthor: number
}

/** The palette pill's label. One glyph on macOS ("⌘K") reads as a unit; on
 *  other platforms "Ctrl" is a word, so "CtrlK" would run the two together —
 *  a thin space (not a full space, which would widen the pill) separates
 *  them instead. */
const PALETTE_KBD_LABEL = isMac ? `${commandKey}K` : `${commandKey} K`

/** The companion's three tenants, in the order the cluster draws them. */
const TENANT_SEGMENTS = [
  {
    tenant: 'structure' as const,
    label: 'Structure',
    keys: 'Ctrl+B',
    Icon: IconStructure,
  },
  {
    tenant: 'proof' as const,
    label: 'Proof — the typeset pages',
    keys: 'Ctrl+J',
    Icon: IconProof,
  },
  {
    tenant: 'agent' as const,
    label: 'Agent',
    keys: 'Ctrl+Shift+A',
    Icon: IconAgent,
  },
]

/**
 * The window's top bar. Extracted from Workspace so the chrome can be
 * designed as a surface of its own; Workspace owns every piece of state and
 * hands down exactly what the bar shows.
 *
 * Layout is a three-column grid: files on the left edge, the document's name
 * in the centre (it doubles as the way to the palette — the tab strip and
 * files popover are gone, and moving between documents is quick-open's job),
 * and the companion's tenants on the right edge, beside the column they
 * open. macOS draws its traffic lights over the top-left of the content
 * (titleBarStyle: Overlay), so the bar leaves TRAFFIC_LIGHT_INSET of room
 * itself — only under Tauri, since the browser preview has no native title
 * bar to make room for.
 *
 * Spacing system, applied throughout: 2px (gap-0.5) between controls inside
 * a cluster, 8px (gap-2) between clusters. No dividers — the gap rhythm is
 * the grouping. The right edge reads as three groups: the quiet reporting
 * pair (update check, ⌘K), the companion cluster — one segmented control,
 * not three scattered buttons, sitting nearest the column it opens — and the
 * native window controls (Windows draws them itself; they manage their own
 * edge margin).
 */
export function TopBar({
  docName,
  dirty,
  conflict,
  tenant,
  onToggleTenant,
  filesOpen,
  onToggleFiles,
  onOpenPalette,
  waitingOnAuthor,
}: TopBarProps) {
  return (
    <header
      data-tauri-drag-region
      // Floating, not a bar (Jack, 2026-08-07): no border, no fill — the
      // controls sit directly on the canvas and the canvas runs to the
      // window's edge. .essay-chrome recedes in focus mode and while words
      // are landing (data-typing); see styles.css.
      className="essay-chrome absolute inset-x-0 top-0 z-30 grid h-10 grid-cols-[1fr_auto_1fr] items-center px-2"
      style={
        isMac && isTauri() ? { paddingLeft: TRAFFIC_LIGHT_INSET } : undefined
      }
    >
      {/* The unsaved dot breathes rather than sits: a slow ease both ways so
          it reads as "alive, unfinished" and never as an alert. Opacity-only,
          and stilled under reduced motion anyway — a dot that pulses forever
          in the corner of a motion-sensitive author's eye is not feedback. */}
      <style>{`
        @keyframes essay-unsaved-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .essay-unsaved-dot {
          animation: essay-unsaved-pulse 2.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .essay-unsaved-dot { animation: none; opacity: 0.7; }
        }
      `}</style>

      {/* Left: files. On macOS the traffic lights sit in the inset just
          before this, on the same optical row (their centreline and the
          28px button's both ride the bar's vertical centre), so the button
          reads as the fourth control in that run rather than an orphan. */}
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <Tip
          label="Files"
          trigger={
            <IconButton
              onClick={onToggleFiles}
              aria-pressed={filesOpen}
              className={cn(
                filesOpen &&
                  'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]',
              )}
            >
              <IconFolders size={16} />
            </IconButton>
          }
        />
      </div>

      {/* Centre: the document's name, which is also the door to the palette.
          The hover affordance is deliberately quiet — the existing hover wash
          plus a small switcher glyph that fades in; the glyph reserves its
          width always so the name never shifts. */}
      <button
        type="button"
        onClick={onOpenPalette}
        title="Switch document"
        className="group flex min-w-0 items-center gap-1.5 justify-self-center rounded-md px-2 py-1 text-[12.5px] font-[510] text-[var(--essay-text)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)]"
      >
        <span className="truncate">{docName}</span>
        {dirty && (
          <span
            aria-label="Unsaved"
            className="essay-unsaved-dot size-[5px] shrink-0 rounded-full bg-[var(--essay-text-faint)]"
          />
        )}
        <CaretUpDown
          size={11}
          aria-hidden
          className="shrink-0 text-[var(--essay-text-faint)] opacity-0 transition-opacity duration-[var(--essay-speed-quick)] group-hover:opacity-100"
        />
      </button>

      {/* Right: quiet reporting, then the companion cluster, then the OS. */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-end gap-2"
      >
        {/* Saved means everything typed has reached disk: autosave clears
            `dirty` for documents with a path, and an untitled buffer with
            anything in it stays dirty by construction. An unanswered disk
            conflict is unfinished business of the same kind. */}
        <UpdateButton documentsSaved={!dirty && !conflict} />

        {/* One quiet pill, not two chips side by side — "⌘" and "K" read as
            a single shortcut, so they sit in a single border. */}
        <button
          type="button"
          onClick={onOpenPalette}
          title="Command palette"
          className="flex h-5 shrink-0 items-center rounded-[4px] border border-[var(--essay-border)] px-1.5 font-(family-name:--essay-font-ui) text-[10.5px] font-[510] text-[var(--essay-text-faint)] transition-colors duration-[var(--essay-speed-quick)] hover:border-[var(--essay-border-strong)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
        >
          {PALETTE_KBD_LABEL}
        </button>

        {/* The companion's tenants as one segmented control: a shallow well
            (surface, hairline border) with the active segment lifted out of
            it on the page background + low shadow — the old ModeSwitch
            idiom. Same icons as the slot's own switcher, so the header
            cluster and the in-slot toggles read as one control in two
            places. Background/shadow/colour transition on selection;
            nothing slides. The segments are IconButtons, so the house press
            feedback (motion-safe:active:scale-[0.96]) comes for free — but
            the transition list below has to keep "transform" in it too, or
            overriding IconButton's own transition property here would leave
            the scale snapping instead of easing back out on release. */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--essay-border)] bg-[var(--essay-surface)] p-0.5">
          {TENANT_SEGMENTS.map(({ tenant: candidate, label, keys, Icon }) => (
            <Tip
              key={candidate}
              label={label}
              shortcut={shortcut(keys)}
              trigger={
                <IconButton
                  onClick={() => onToggleTenant(candidate)}
                  aria-pressed={tenant === candidate}
                  className={cn(
                    'relative h-6 w-7 rounded-[6px] transition-[background-color,color,box-shadow,transform] duration-[var(--essay-speed-quick)]',
                    tenant === candidate
                      ? 'bg-[var(--essay-bg)] text-[var(--essay-text)] shadow-[var(--essay-shadow-low)] hover:bg-[var(--essay-bg)]'
                      : 'hover:bg-transparent',
                  )}
                >
                  <Icon size={16} />
                  {/* A decision waiting on the author earns an actual dot,
                      not a tinted glyph — tinting the whole icon read as
                      "this button is a different colour," not "something
                      needs you." Only the agent segment carries it, and
                      only while a proposal is pending; it is the sole place
                      that state shows when the slot holds something else. */}
                  {candidate === 'agent' && waitingOnAuthor > 0 && (
                    <span
                      aria-label={`${waitingOnAuthor} waiting on you`}
                      title={`${waitingOnAuthor} waiting on you`}
                      className="absolute top-0.5 right-0.5 size-1 rounded-full bg-[var(--essay-accent)]"
                    />
                  )}
                </IconButton>
              }
            />
          ))}
        </div>

        <WindowControls />
      </div>
    </header>
  )
}
