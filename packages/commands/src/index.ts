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

export function listCommands(): Command[] {
  return [...registry.values()].sort((a, b) => a.title.localeCompare(b.title))
}
