import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  IconAgent,
  IconClose,
  IconHistory,
  IconProof,
  IconStructure,
} from './icons'
import { cn } from '#/lib/cn'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'

/**
 * The companion — the one right-hand slot (docs/ui-overhaul.md, "The spine").
 *
 * Exactly one tenant at a time. That is the whole discipline: two rails is how
 * a writing tool becomes an IDE, and the layout this replaces had already
 * grown one (the sidebar pane stack beside the agent rail). The slot holds one
 * of four things — Structure, Proof, Agent, History — and the author switches
 * between them rather than accumulating them.
 *
 * The slot renders; `Workspace` owns everything else. Tenant nodes arrive as
 * props because their state and wiring (preview debounce, revision queries,
 * the agent session) belong to the shell, and because step 1 of the overhaul
 * drops today's panes in *unchanged* — this component must not know what is
 * inside them.
 */

export type CompanionTenant = 'structure' | 'proof' | 'agent' | 'history'

/** Matches today's AGENT_PANEL_WIDTH: measured for a readable transcript, and
    the other tenants were living in less. One width for one slot. */
const COMPANION_WIDTH = 340

export interface CompanionProps {
  /** null = slot closed. */
  tenant: CompanionTenant | null
  onTenantChange: (tenant: CompanionTenant | null) => void
  /** The slot renders these; Workspace owns all state/wiring. */
  structure: ReactNode
  proof: ReactNode
  agent: ReactNode
  history: ReactNode
}

const TENANTS: Array<{
  tenant: CompanionTenant
  label: string
  Icon: typeof IconStructure
}> = [
  { tenant: 'structure', label: 'Structure', Icon: IconStructure },
  { tenant: 'proof', label: 'Proof', Icon: IconProof },
  { tenant: 'agent', label: 'Agent', Icon: IconAgent },
  { tenant: 'history', label: 'History', Icon: IconHistory },
]

/** `prefers-reduced-motion` as state. The entrance choreography below is
    JS-driven (a transition needs one committed frame at the off-stage style
    before it can settle), so the media query has to be consulted from JS
    too — see the token comment in @essay/theme: surfaces that move own
    their reduced-motion opt-out. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function Companion({
  tenant,
  onTenantChange,
  structure,
  proof,
  agent,
  history,
}: CompanionProps) {
  const open = tenant !== null
  const reduceMotion = usePrefersReducedMotion()

  // Entrance: the column arrives rather than pops. The Workspace grid sizes
  // this track `auto`, so animating *width* would resize the track — and
  // reflow the prose column — every frame; instead the aside claims its full
  // 340px at once (one reflow) and a fixed-width inner frame slides in by
  // transform under `overflow-hidden`. Compositor-only, and the prose
  // settles at its final measure immediately instead of chasing the panel.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    if (reduceMotion) {
      setEntered(true)
      return
    }
    // Double rAF: the first frame commits the off-stage style, the second
    // flips it so the transition has something to travel from.
    let inner: number | null = null
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      if (inner !== null) cancelAnimationFrame(inner)
    }
  }, [open, reduceMotion])

  // Tenant switch: the incoming content fades in and rises 2px. The fade is
  // applied to the shared stage wrapper *around* all four tenant slots — a
  // style change on an ancestor, never a keyed remount — so the
  // always-mounted agent wrapper keeps its position in the element tree
  // (see the mounting comment below). Skipped on open/close (the entrance
  // slide already carries those) and replayed only between two live tenants.
  const prevTenant = useRef(tenant)
  const [stageIn, setStageIn] = useState(true)
  // Layout effect, not effect: the incoming tenant must be committed at
  // opacity 0 *before* its first paint, or it flashes for a frame.
  useLayoutEffect(() => {
    const prev = prevTenant.current
    prevTenant.current = tenant
    if (reduceMotion || tenant === null || prev === null || prev === tenant)
      return
    setStageIn(false)
    let inner: number | null = null
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setStageIn(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      if (inner !== null) cancelAnimationFrame(inner)
    }
  }, [tenant, reduceMotion])
  // The column itself is hidden rather than unmounted when the slot is
  // closed, and the agent wrapper below is hidden rather than unmounted when
  // another tenant is showing. Both for the same reason: the agent node must
  // never change its position in the element tree, or React would remount it
  // — and a session, a transcript and a queue of proposals all outlive the
  // author glancing away (see the AgentPanel mounting comment in
  // Workspace.tsx). An agent that kept working while the author read their
  // history must not come back to an empty panel. The other three tenants
  // hold no state anyone needs while they are hidden, so they mount and
  // unmount freely.
  //
  // A `hidden` column contributes no visible width; the Workspace grid owns
  // collapsing its track when the slot is closed.
  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col overflow-hidden border-l border-[var(--essay-border)] bg-[var(--essay-bg)]',
        tenant === null && 'hidden',
      )}
      style={{ width: COMPANION_WIDTH }}
      aria-label="Companion"
    >
      {/* The sliding frame: fixed width so the entrance is transform-only
          (the aside clips it). `transform: 'none'` once settled, so the
          frame stops being a containing block for any fixed/absolute
          descendants a tenant might position. */}
      <div
        className="flex h-full min-h-0 flex-col"
        style={{
          width: COMPANION_WIDTH,
          ...(reduceMotion
            ? undefined
            : {
                transform: entered ? 'none' : 'translateX(16px)',
                opacity: entered ? 1 : 0,
                transition:
                  'transform var(--essay-speed-slow) var(--essay-ease-swift), opacity var(--essay-speed-slow) var(--essay-ease-out)',
              }),
        }}
      >
        <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-[var(--essay-border)] px-2">
          {TENANTS.map(({ tenant: candidate, label, Icon }) => (
            <Tip
              key={candidate}
              label={label}
              trigger={
                <IconButton
                  onClick={() => onTenantChange(candidate)}
                  aria-pressed={tenant === candidate}
                  className={cn(
                    tenant === candidate &&
                      'bg-[var(--essay-surface-hover)] text-[var(--essay-text)]',
                  )}
                >
                  <Icon size={16} />
                </IconButton>
              }
            />
          ))}
          <div className="flex-1" />
          <Tip
            label="Close"
            trigger={
              <IconButton onClick={() => onTenantChange(null)} aria-label="Close companion">
                <IconClose size={16} />
              </IconButton>
            }
          />
        </div>

        {/* The stage: one wrapper around all four tenant slots so a tenant
            switch is a fade on this ancestor, never a keyed remount of a
            slot — the agent wrapper's tree position is load-bearing. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={
            reduceMotion
              ? undefined
              : {
                  opacity: stageIn ? 1 : 0,
                  transform: stageIn ? 'none' : 'translateY(2px)',
                  transition:
                    'transform var(--essay-speed-regular) var(--essay-ease-out), opacity var(--essay-speed-regular) var(--essay-ease-out)',
                }
          }
        >
          {tenant === 'structure' && (
            <div className="min-h-0 flex-1 overflow-y-auto">{structure}</div>
          )}
          {tenant === 'proof' && (
            <div className="min-h-0 flex-1 overflow-hidden">{proof}</div>
          )}
          {/* Always mounted; see the comment above. */}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-hidden',
              tenant !== 'agent' && 'hidden',
            )}
          >
            {agent}
          </div>
          {tenant === 'history' && (
            <div className="min-h-0 flex-1 overflow-y-auto">{history}</div>
          )}
        </div>
      </div>
    </aside>
  )
}

// ——— Which tenant each document left open ———
//
// Remembered per document (docs/ui-overhaul.md: "remembered per document")
// because the tenant is a fact about the work, not the installation: the memo
// being finished wants Proof, the chapter mid-argument wants Structure, and
// switching between them should not drag the slot along. Persistence is
// localStorage, alongside recents and the workspace folders, for the same
// reason they live there: a preference about this machine, deletable at the
// cost of a default, never a document.

const TENANT_KEY = 'essay.companion.v1'

/** Enough documents to cover everything an author plausibly returns to;
    beyond that an entry is a stale path's tenant sitting in storage for
    ever. Insertion order is the age order — JSON round-trips it — so
    pruning drops the least recently saved. */
const MAX_TENANT_ENTRIES = 50

const TENANT_VALUES: ReadonlySet<string> = new Set([
  'structure',
  'proof',
  'agent',
  'history',
])

function loadTenantMap(): Record<string, CompanionTenant> {
  try {
    const raw = localStorage.getItem(TENANT_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return {}
    const map: Record<string, CompanionTenant> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && TENANT_VALUES.has(value)) {
        map[key] = value as CompanionTenant
      }
    }
    return map
  } catch {
    return {}
  }
}

export function loadCompanionTenant(docKey: string): CompanionTenant | null {
  return loadTenantMap()[docKey] ?? null
}

/**
 * Record the tenant a document's slot holds. `null` — the author closed the
 * slot — drops the entry rather than storing a sentinel: `loadCompanionTenant`
 * answers `null` either way, "closed" is the default posture for a document
 * Essay has never seen (the flow opens in Prose with no furniture), and an
 * entry that only restated the default would spend one of the fifty slots
 * saying nothing.
 */
export function saveCompanionTenant(
  docKey: string,
  tenant: CompanionTenant | null,
): void {
  const map = loadTenantMap()
  // Re-insert at the end so insertion order stays recency order, which is
  // what makes the prune below drop the oldest rather than an arbitrary one.
  delete map[docKey]
  const entries = Object.entries(map)
  if (tenant !== null) entries.push([docKey, tenant])
  const pruned = Object.fromEntries(entries.slice(-MAX_TENANT_ENTRIES))
  try {
    localStorage.setItem(TENANT_KEY, JSON.stringify(pruned))
  } catch {
    // A full or disabled localStorage costs a remembered tenant, never the
    // document it was remembered for.
  }
}
