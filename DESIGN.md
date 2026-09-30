# Lightning visual system

## Direction

**Quiet precision.** Lightning is a practical, private transfer utility. The
interface puts the next action, destination, and real transfer state first.
Use quiet surfaces, clear labels, and deliberate spacing. Avoid dashboard
instrumentation in ordinary flows, decorative blur, neon effects, and claims
that are not supported by evidence.

## Core tokens

| Token          | Value     | Use                                       |
| -------------- | --------- | ----------------------------------------- |
| Canvas         | `#101216` | Dark graphite app background              |
| Surface        | `#181B21` | Main content surface                      |
| Raised surface | `#222730` | Inputs, selected rows, and popovers       |
| Primary text   | `#F4F5F7` | Titles and body copy                      |
| Secondary text | `#B9BFCA` | Supporting copy                           |
| Muted text     | `#858D9A` | Metadata only                             |
| Action blue    | `#315EFF` | Primary actions, focus, and selection     |
| Porcelain      | `#FAF9F6` | Light content sections and paper surfaces |
| Amber          | `#E8BF70` | Cautions and uncertain network state      |
| Error          | `#E05763` | Failure state, paired with clear text     |

The token definitions live in `src/index.css`. `--signal-green` remains a
compatibility alias for the action blue while older selectors are migrated.
Green is reserved for verified or successful states. Never use color alone to
communicate state.

## Type, spacing, and controls

- Use the system sans-serif stack for interface copy. Use monospace only for
  tickets, hashes, and diagnostics.
- Keep normal body copy at 15–16 px where layout permits. Use tabular numbers
  for transfer sizes, rates, and progress.
- Follow an 8 px spacing rhythm with 4 px optical adjustments.
- Make touch controls at least 44 px high. Keep keyboard focus visible.
- Use restrained corner radii and borders; reserve blur for overlays where it
  improves separation.
- Respect reduced-motion settings. Motion should show a state change and never
  delay networking or a primary action.

## Product hierarchy

The Transfer workspace is the default. It combines file selection, a stable
nearby destination list, and link sharing. Devices, Chat, and Activity remain
one navigation step away; Settings stays secondary. Incoming offers show the
claimed sender name and the authenticated peer identity, plus file details and
Accept or Decline actions.

The browser receiver, app shell, dialogs, onboarding, and website should use
these tokens and the same plain-language status model. Platform pickers,
window controls, safe areas, keyboard behavior, and share sheets remain native
to their host platform.
