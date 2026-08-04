/**
 * Every icon the agent surfaces use, named for what it means rather than for
 * what it draws.
 *
 * The point is the indirection. Components ask for `ThinkingIcon`, not for a
 * particular glyph from a particular set, so a styling pass can re-point the
 * right-hand side of this file — to different Phosphor weights, to a different
 * family, or to bespoke SVGs — without touching a component. If a future set
 * has no equivalent for something, that shows up here as one broken line
 * rather than as a hunt through a thousand lines of panel.
 *
 * Current set: Phosphor. Never Lucide.
 */

import {
  ArrowClockwise,
  ArrowUUpLeft,
  ArrowsClockwise,
  ArrowsDownUp,
  BookmarkSimple,
  Brain,
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  DotsThree,
  Faders,
  FileText,
  HardDrives,
  PaperPlaneRight,
  PencilSimple,
  Plugs,
  Prohibit,
  Robot,
  SidebarSimple,
  Stop,
  Terminal,
  TextAa,
  Trash,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react'

export type { Icon }

/** An agent, and the chrome toggle that opens its pane. */
export const AgentIcon = Robot
/** Reasoning the agent showed on its way to an answer. */
export const ThinkingIcon = Brain
/** A tool call, where nothing more specific fits. */
export const ToolIcon = Terminal
/** A tool that changed something. */
export const EditIcon = PencilSimple
/** A document, and a tool that only read one. */
export const DocumentIcon = FileText
/** An edit that has already reached the filesystem. */
export const OnDiskIcon = HardDrives

/** Take the change. */
export const AcceptIcon = CheckCircle
/** Decline a proposal that never touched the file. */
export const RejectIcon = Prohibit
/** Undo a change that did. */
export const RevertIcon = ArrowUUpLeft
/** Try the turn again. */
export const RetryIcon = ArrowClockwise

/** Send the prompt. */
export const SendIcon = PaperPlaneRight
/** Interrupt the turn in progress. */
export const StopIcon = Stop
/** Work in progress; spun by the caller. */
export const BusyIcon = CircleNotch
/** Connecting to an agent process. */
export const ConnectIcon = Plugs

/** The agent's knobs — mode, model, whatever it advertises. */
export const TuneIcon = Faders

/** Something went wrong and the author needs to know. */
export const ErrorIcon = WarningCircle
/** There is more here than is shown. */
export const MoreIcon = DotsThree

/** Disclosure, closed and open. */
export const ExpandIcon = CaretRight
export const CollapseIcon = CaretDown
/** Dismiss a panel, a tab, a notice. */
export const CloseIcon = X

/** The document's history, and the pane that shows it. */
export const HistoryIcon = ClockCounterClockwise
/** A state the author marked as one worth keeping. */
export const CheckpointIcon = BookmarkSimple

/** A section that moved rather than changed. */
export const MovedIcon = ArrowsDownUp
/** A section rewritten rather than edited. */
export const RewriteIcon = ArrowsClockwise
/** Show or hide the outline pane. */
export const SidebarIcon = SidebarSimple
/** A typeface, and the pane that manages them. */
export const FontIcon = TextAa
/** Removing something the author installed. */
export const RemoveIcon = Trash
