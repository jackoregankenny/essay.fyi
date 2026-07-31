import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { ArrowClockwise, FolderSimplePlus, X } from '@phosphor-icons/react'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'
import {
  joinPath,
  listMarkdownTree,
  loadWorkspaceFolders,
  pickWorkspaceFolder,
  saveWorkspaceFolders,
  type WorkspaceFolder,
} from '#/lib/workspace'

// Browser preview has no filesystem; show a static demo tree instead so the
// explorer stays designable outside the desktop shell.
const DEMO_FOLDER: WorkspaceFolder = { path: '', name: 'example' }
const DEMO_PATHS = [
  'drafts/',
  'drafts/board-memo.md',
  'drafts/distribution-essay.md',
  'research/',
  'research/interviews/',
  'research/interviews/2026-06-pilots.md',
  'notes.md',
]

interface ExplorerPaneProps {
  onOpenFile: (absolutePath: string) => void
}

export function ExplorerPane({ onOpenFile }: ExplorerPaneProps) {
  const desktop = isTauri()
  const [folders, setFolders] = useState<WorkspaceFolder[]>(() =>
    desktop ? loadWorkspaceFolders() : [DEMO_FOLDER],
  )

  const update = (next: WorkspaceFolder[]) => {
    setFolders(next)
    if (desktop) saveWorkspaceFolders(next)
  }

  const addFolder = async () => {
    const folder = await pickWorkspaceFolder()
    if (!folder || folders.some((f) => f.path === folder.path)) return
    update([...folders, folder])
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1 px-3 pt-3 pb-1">
        <h2 className="text-[11px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase">
          Files
        </h2>
        <div className="ml-auto">
          <Tip
            label={desktop ? 'Add folder to workspace' : 'Available in the desktop app'}
            trigger={
              <IconButton
                className="h-6 w-6"
                disabled={!desktop}
                onClick={() => void addFolder()}
              >
                <FolderSimplePlus size={15} weight="bold" />
              </IconButton>
            }
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {folders.length === 0 ? (
          <div className="px-2 py-3 text-[13px] leading-relaxed text-[var(--essay-text-faint)]">
            No folders yet.
            <br />
            Add any number of folders — the workspace is not tied to a single
            vault.
          </div>
        ) : (
          folders.map((folder) => (
            <RootSection
              key={folder.path || folder.name}
              folder={folder}
              demo={!desktop}
              onOpenFile={onOpenFile}
              onRemove={() => update(folders.filter((f) => f !== folder))}
            />
          ))
        )}
      </div>
    </section>
  )
}

function RootSection({
  folder,
  demo,
  onOpenFile,
  onRemove,
}: {
  folder: WorkspaceFolder
  demo: boolean
  onOpenFile: (absolutePath: string) => void
  onRemove: () => void
}) {
  const [paths, setPaths] = useState<string[] | null>(demo ? DEMO_PATHS : null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (demo) return
    let live = true
    listMarkdownTree(folder.path)
      .then((p) => live && setPaths(p))
      .catch(() => live && setPaths([]))
    return () => {
      live = false
    }
  }, [folder.path, demo, reloadKey])

  return (
    <div className="group/root mb-1">
      <div className="flex h-6 items-center gap-1 rounded px-1">
        <span
          className="truncate text-[12px] font-medium text-[var(--essay-text-muted)]"
          title={folder.path || undefined}
        >
          {folder.name}
        </span>
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover/root:opacity-100">
          {!demo && (
            <Tip
              label="Refresh"
              trigger={
                <IconButton
                  className="h-5 w-5"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <ArrowClockwise size={12} />
                </IconButton>
              }
            />
          )}
          <Tip
            label="Remove from workspace"
            trigger={
              <IconButton className="h-5 w-5" onClick={onRemove}>
                <X size={12} />
              </IconButton>
            }
          />
        </div>
      </div>
      {paths === null ? (
        <p className="px-2 py-1 text-[12px] text-[var(--essay-text-faint)]">
          Loading…
        </p>
      ) : paths.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-[var(--essay-text-faint)]">
          No Markdown files
        </p>
      ) : (
        <RootTree
          key={reloadKey}
          paths={paths}
          onOpen={(rel) =>
            demo ? undefined : onOpenFile(joinPath(folder.path, rel))
          }
        />
      )}
    </div>
  )
}

function RootTree({
  paths,
  onOpen,
}: {
  paths: string[]
  onOpen: (relPath: string) => void
}) {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  const { model } = useFileTree({
    paths,
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    onSelectionChange: (selected) => {
      const rel = selected[0]
      if (rel && !rel.endsWith('/')) onOpenRef.current(rel)
    },
  })

  // The tree virtualizes inside a bounded host; in the stacked multi-root
  // sidebar each root sizes to its visible rows and the sidebar scrolls.
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    const update = () =>
      setHeight(model.getVisibleCount() * model.getItemHeight())
    update()
    return model.subscribe(update)
  }, [model])

  return (
    <FileTree model={model} className="essay-file-tree" style={{ height }} />
  )
}
