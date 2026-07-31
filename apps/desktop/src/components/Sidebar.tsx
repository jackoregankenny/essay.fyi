import type { OutlineItem } from '@essay/editor'
import { ExplorerPane } from './ExplorerPane'
import { OutlinePane } from './OutlinePane'

interface SidebarProps {
  outline: OutlineItem[]
  onSelectOutline: (item: OutlineItem) => void
  onOpenFile: (absolutePath: string) => void
}

export function Sidebar({ outline, onSelectOutline, onOpenFile }: SidebarProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--essay-border)] bg-[var(--essay-surface)]">
      <ExplorerPane onOpenFile={onOpenFile} />
      <OutlinePane outline={outline} onSelect={onSelectOutline} />
    </aside>
  )
}
