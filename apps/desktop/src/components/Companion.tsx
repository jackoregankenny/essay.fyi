import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { IconClose } from './icons'
import { cn } from '#/lib/cn'
import { IconButton } from './ui/icon-button'

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

export interface CompanionProps {
  /** null = slot closed. */
  tenant: CompanionTenant | null
  onTenantChange: (tenant: CompanionTenant | null) => void
  /** The slot renders these; Workspace owns all state/wiring. */
  structure: ReactNode
  proof: ReactNode
  agent: ReactNode
  history: ReactNode
  /** Decisions remain visible even when another reading is selected. */
  waitingOnAuthor?: number
}

const TENANT_LABELS: ReadonlyArray<
  readonly [CompanionTenant, string]
> = [
  ['structure', 'Structure'],
  ['proof', 'Proof'],
  ['agent', 'Agent'],
  ['history', 'History'],
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
  waitingOnAuthor = 0,
}: CompanionProps) {
  const open = tenant !== null
  const reduceMotion = usePrefersReducedMotion()
  // Keep the last tenant rendered while the field leaves. The old `hidden`
  // implementation had an entrance but no exit — content disappeared before
  // the panel could move. This also keeps the agent at one stable tree
  // position for the lifetime of the workspace.
  const [visibleTenant, setVisibleTenant] = useState<CompanionTenant>(
    tenant ?? 'structure',
  )

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
    if (tenant === null || prev === tenant) return
    setVisibleTenant(tenant)
    if (reduceMotion || prev === null) return
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
  return (
    <aside
      className="essay-companion z-20 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--essay-editor-bg)]"
      data-open={open ? '' : undefined}
      data-tenant={visibleTenant}
      aria-hidden={!open}
      inert={!open}
      aria-label="Companion"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-10 shrink-0 items-center px-2">
          <nav
            aria-label="Document panels"
            className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden px-1 text-[11px] font-[510] text-[var(--essay-text-muted)]"
          >
            {TENANT_LABELS.map(([candidate, label]) => {
              const active = visibleTenant === candidate && open
              const waiting =
                candidate === 'agent' && waitingOnAuthor > 0
                  ? waitingOnAuthor
                  : 0
              return (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onTenantChange(candidate)}
                  className={`flex shrink-0 items-center gap-1.5 transition-colors duration-[var(--essay-speed-quick)] hover:text-[var(--essay-text)] ${
                    active ? 'text-[var(--essay-text)]' : ''
                  }`}
                >
                  {waiting > 0 && (
                    <span
                      aria-hidden
                      className="size-1 rounded-full bg-[var(--essay-accent)]"
                    />
                  )}
                  {label}
                  {waiting > 0 && (
                    <span className="tabular-nums">{waiting}</span>
                  )}
                </button>
              )
            })}
          </nav>
          <IconButton
            onClick={() => onTenantChange(null)}
            aria-label="Close panel"
            className="h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
          >
            <IconClose size={13} />
          </IconButton>
        </header>
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
          {visibleTenant === 'structure' && (
            <div className="min-h-0 flex-1 overflow-y-auto">{structure}</div>
          )}
          {visibleTenant === 'proof' && (
            <div className="min-h-0 flex-1 overflow-hidden">{proof}</div>
          )}
          {/* Always mounted; see the comment above. */}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-hidden',
              visibleTenant !== 'agent' && 'hidden',
            )}
          >
            {agent}
          </div>
          {visibleTenant === 'history' && (
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
