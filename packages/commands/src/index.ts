/**
 * @essay/commands — command registry.
 *
 * Hosts (Essay itself, and later embedders) register commands here; the
 * command palette (Milestone 1) and menus read from this registry. The
 * registry stays UI-free so it can back any chrome.
 */

export interface Command {
  id: string
  title: string
  /** Palette group header, e.g. 'File', 'Format'. */
  group?: string
  /** Display-only shortcut hint, e.g. 'Ctrl+S'. */
  shortcut?: string
  /** Extra terms the palette matches against. */
  keywords?: string
  run: () => void | Promise<void>
}

const registry = new Map<string, Command>()

export function registerCommand(command: Command): () => void {
  registry.set(command.id, command)
  return () => {
    registry.delete(command.id)
  }
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

/** Registration order is presentation order — hosts register groups together. */
export function listCommands(): Command[] {
  return [...registry.values()]
}
