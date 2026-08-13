import type { ComponentType } from 'react'
import {
  IconAgent,
  IconHistory,
  IconProof,
  IconStructure,
  type IconProps,
} from './icons'
import { shortcut } from '#/lib/platform'
import type { CompanionTenant } from './companion-state'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'

interface WorkspaceRailProps {
  tenant: CompanionTenant | null
  waitingOnAuthor: number
  openComments: number
  onToggleTenant: (tenant: CompanionTenant) => void
}

const TENANTS: ReadonlyArray<
  readonly [
    CompanionTenant,
    string,
    ComponentType<IconProps>,
    string?,
    string?,
  ]
> = [
  [
    'structure',
    'Structure',
    IconStructure,
    shortcut('Ctrl+B'),
    'Control+B Meta+B',
  ],
  ['proof', 'Proof', IconProof, shortcut('Ctrl+J'), 'Control+J Meta+J'],
  [
    'agent',
    'Agent',
    IconAgent,
    shortcut('Ctrl+Shift+A'),
    'Control+Shift+A Meta+Shift+A',
  ],
  ['history', 'History', IconHistory],
]

/**
 * Floating reading controls in the page's outer margin. This is deliberately
 * not a rail: no full-height container, edge fill, or line separates it from
 * the manuscript. The controls remain still while their reading opens under
 * them.
 */
export function WorkspaceRail({
  tenant,
  waitingOnAuthor,
  openComments,
  onToggleTenant,
}: WorkspaceRailProps) {
  return (
    <nav
      aria-label="Document readings"
      className="essay-reading-controls essay-chrome flex flex-col items-center gap-1"
    >
      {TENANTS.map(
        ([candidate, label, Icon, shortcutLabel, keyShortcuts]) => (
          <RailButton
            key={candidate}
            label={label}
            active={tenant === candidate}
            icon={Icon}
            controls="essay-companion-panel"
            shortcutLabel={shortcutLabel}
            keyShortcuts={keyShortcuts}
            badge={
              candidate === 'agent'
                ? waitingOnAuthor
                : candidate === 'structure'
                  ? openComments
                  : 0
            }
            badgeLabel={
              candidate === 'agent'
                ? 'decisions waiting'
                : candidate === 'structure'
                  ? 'open comments'
                  : undefined
            }
            onClick={() => onToggleTenant(candidate)}
          />
        ),
      )}
    </nav>
  )
}

function RailButton({
  label,
  active,
  icon: Icon,
  controls,
  shortcutLabel,
  keyShortcuts,
  badge = 0,
  badgeLabel,
  onClick,
}: {
  label: string
  active: boolean
  icon: ComponentType<IconProps>
  controls: string
  shortcutLabel?: string
  keyShortcuts?: string
  badge?: number
  badgeLabel?: string
  onClick: () => void
}) {
  const accessibleLabel =
    badge > 0 && badgeLabel ? `${label}, ${badge} ${badgeLabel}` : label

  return (
    <Tip
      label={label}
      shortcut={shortcutLabel}
      side="left"
      trigger={
        <IconButton
          onClick={onClick}
          aria-label={accessibleLabel}
          aria-controls={controls}
          aria-expanded={active}
          aria-keyshortcuts={keyShortcuts}
          className={`relative h-8 w-8 rounded-full bg-transparent ${
            active
              ? 'text-[var(--essay-accent)]'
              : 'text-[var(--essay-text-muted)] opacity-70 hover:opacity-100'
          }`}
        >
          <Icon size={14} />
          {active && (
            <span
              aria-hidden
              className="absolute top-1/2 -right-1 size-1 -translate-y-1/2 rounded-full bg-[var(--essay-accent)]"
            />
          )}
          {badge > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-1 -right-1 min-w-4 rounded-full bg-[var(--essay-accent)] px-1 text-center text-[9px] font-[590] leading-4 tabular-nums text-white"
            >
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </IconButton>
      }
    />
  )
}
