import { isTauri } from '@tauri-apps/api/core'
import { Minus, Square, X } from '@phosphor-icons/react'
import { cn } from '#/lib/cn'
import { isWindows } from '#/lib/platform'

async function currentWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/**
 * Windows-style window controls for the frameless window. The header
 * doubles as the titlebar (data-tauri-drag-region); these are the only
 * chrome the OS no longer draws for us.
 *
 * Windows only, and the shape of these buttons is why: they are square, they
 * are top-right, and the close button turns Segoe red. On macOS the window
 * keeps its decorations (`titleBarStyle: Overlay`) and the OS draws real
 * traffic lights top-left; on Linux the window manager draws its own frame.
 * On both, rendering these as well would put a second, foreign set of window
 * buttons in the wrong corner — worse than none, because both sets work.
 */
export function WindowControls() {
  if (!isTauri() || !isWindows) return null
  return (
    <div className="-mr-2 ml-1 flex h-10 items-stretch">
      <ControlButton
        label="Minimize"
        onClick={() => void currentWindow().then((w) => w.minimize())}
      >
        <Minus size={14} />
      </ControlButton>
      <ControlButton
        label="Maximize"
        onClick={() => void currentWindow().then((w) => w.toggleMaximize())}
      >
        <Square size={11} />
      </ControlButton>
      <ControlButton
        label="Close"
        danger
        onClick={() => void currentWindow().then((w) => w.close())}
      >
        <X size={14} />
      </ControlButton>
    </div>
  )
}

function ControlButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex w-11 items-center justify-center text-[var(--essay-text-muted)] transition-colors duration-100',
        danger
          ? 'hover:bg-[#c42b1c] hover:text-white'
          : 'hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
      )}
    >
      {children}
    </button>
  )
}
