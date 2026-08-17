import { type ReactNode } from 'react'
import { cn } from '#/lib/cn'
import type { CompanionTenant } from './companion-state'

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

export interface CompanionProps {
  /** null = slot closed. */
  tenant: CompanionTenant | null
  /** The slot renders these; Workspace owns all state/wiring. */
  structure: ReactNode
  tasks: ReactNode
  proof: ReactNode
  agent: ReactNode
  history: ReactNode
}

export function Companion({
  tenant,
  structure,
  tasks,
  proof,
  agent,
  history,
}: CompanionProps) {
  const open = tenant !== null
  const visibleTenant = tenant ?? 'structure'
  return (
    <aside
      id="essay-companion-panel"
      // No z here: `.essay-companion` owns it, and it has to change with the
      // width (a column beside the page, versus the whole canvas). A utility
      // alongside it would be a second answer to the same question.
      className="essay-companion flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-open={open ? '' : undefined}
      data-tenant={visibleTenant}
      aria-hidden={!open}
      inert={!open}
      aria-label="Companion"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          {visibleTenant === 'structure' && (
            <div className="essay-tenant-reading min-h-0 flex-1 overflow-y-auto">{structure}</div>
          )}
          {visibleTenant === 'tasks' && (
            <div className="essay-tenant-reading min-h-0 flex-1 overflow-y-auto">{tasks}</div>
          )}
          {visibleTenant === 'proof' && (
            <div className="essay-tenant-reading min-h-0 flex-1 overflow-hidden">{proof}</div>
          )}
          {/* Always mounted; see the comment above. */}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-hidden',
              visibleTenant === 'agent' ? 'essay-tenant-reading' : 'hidden',
            )}
          >
            {agent}
          </div>
          {visibleTenant === 'history' && (
            <div className="essay-tenant-reading min-h-0 flex-1 overflow-y-auto">{history}</div>
          )}
        </div>
      </div>
    </aside>
  )
}
