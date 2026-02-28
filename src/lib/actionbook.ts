/**
 * Actionbook Integration Layer
 *
 * Two-layer architecture:
 * 1. SDK (`@actionbookdev/sdk`) — searches action manuals for verified selectors (knowledge layer)
 * 2. CLI (`@actionbookdev/cli`) — controls Chrome browser for automation (execution layer)
 *
 * The SDK returns plain text designed for LLM consumption.
 * The CLI is invoked via child_process for browser operations.
 */

export type { BrowserCommandResult, BookingStepResult } from './actionbook-sdk.js';
export { searchActionManuals, getActionManual } from './actionbook-sdk.js';
export {
  browserOpen,
  browserClick,
  browserFill,
  browserSelect,
  browserPress,
  browserWait,
  browserScreenshot,
  browserSnapshot,
  browserText,
  browserEval,
  browserClickByText,
  browserFillInFrame,
  browserClickInFrame,
  browserFillByLabel,
  browserClose,
  browserGoto,
  browserHover,
  browserFocus,
  extractDomain,
  buildSearchQuery,
} from './actionbook-cli.js';
