import type { ReactElement, ReactNode } from 'react'
import { Tooltip } from '@base-ui-components/react/tooltip'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delay={450}>{children}</Tooltip.Provider>
}

interface TipProps {
  label: string
  shortcut?: string
  /** The trigger element; tooltip props are merged onto it (shadcn asChild-style). */
  trigger: ReactElement<Record<string, unknown>>
}

export function Tip({ label, shortcut, trigger }: TipProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={6}>
          <Tooltip.Popup className="essay-pop z-50 flex items-center gap-1.5 rounded-lg border border-[var(--essay-border)] bg-[var(--essay-bg)] px-2 py-1 text-xs text-[var(--essay-text)] shadow-[var(--essay-shadow-medium)]">
            {label}
            {shortcut && (
              <kbd className="font-[var(--essay-font-ui)] text-[10px] tracking-wide text-[var(--essay-text-faint)]">
                {shortcut}
              </kbd>
            )}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
