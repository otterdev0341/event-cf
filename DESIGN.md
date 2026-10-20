# Event Confirm — Exa-inspired workspace design

Status: implemented as a Phase 1–5 development workspace in frontend/; production API/cutover remain P6–P8.
Source: the Exa reference supplied by the user, adapted to an authenticated event workspace.

## Product context

Staff manage organizations, events, categorized FAQ and follow-up tickets.
External agents read published knowledge and create unanswered-question/callback tickets.
Staff download/upload participant templates and manage new/fail call queues with X:1 scheduling.
Eligible terminal unknown outcomes can enter the retry lane; confirm/decline stop retries.
Machine integrations use paired org/event credentials, with calling scopes opt-in.
The core workspace must prioritize scanning, editing and tracking work.

Use the reference's white/greige surfaces, editorial serif, mono metadata, hairline
borders and tight radii. Marketing hero proportions do not apply to every application page.
Dark editorial surfaces belong in onboarding/product explanation or API examples;
keep the main FAQ editor and Kanban legible on a consistent light canvas.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `canvas` | `#ffffff` | Workspace and page background |
| `surface-cream` | `#f5f3ef` | Secondary panels, subtle grouped areas |
| `border` | `#e5e7eb` | Hairline cards, tables, fields and separators |
| `surface-dark` | `#181815` | API/example and editorial panels |
| `ink` | `#111827` | Headings and primary content |
| `ink-body` | `#444444` | Body copy |
| `ink-muted` | `#787572` | Secondary information; verify contrast at actual size |
| `greige-warm` | `#675e56` | Quiet control labels |
| `action-neutral` | `#f2f0ef` | Structural CTA fill |
| `action-neutral-ink` | `#514837` | Structural CTA text |
| `brand` | `#1f40ed` | Links, focus, selected/high-intent emphasis |
| `brand-hover` | `#0d2189` | Brand action hover/pressed |
| `brand-deep` | `#000a40` | Restricted deep brand emphasis |
| `shadow-warm` | `#89661a` | Low-opacity shadow only; never status/text fill |

The supplied reference has conflicting neutral CTA values: prose uses
`#f2f0ef/#514837`, while its component table uses `#e5e7eb/#675e56`.
Choose the former for neutral action tokens and retain `#e5e7eb` for borders.
This is an explicit project choice rather than a claim about live Exa CSS.

Add semantic success/warning/danger tokens during component implementation, with
contrast tests and text/icons. Do not make every Kanban column a large colored panel.

## Typography

| Voice | Reference | Initial project fallback | Size/use |
|---|---|---|---|
| Display | Arizona light serif | Georgia/serif; Thai serif fallback if provisioned | 32–42px workspace titles; up to 76.8px only on large editorial hero |
| Body | ABCDiatype | Inter + existing Noto Sans Thai + sans-serif | 14–16px controls/body; 17–19px introductory copy |
| Metadata | Geist Mono | Geist Mono when provisioned, then monospace | 12–13px IDs, timestamps, API examples and counters |

Do not bundle Arizona, ABCDiatype or any suggested commercial substitute without
appropriate rights/assets. The reference's description of substitutes is not a license.
Keep Thai paragraph line-height around 1.5–1.65 and avoid tight negative tracking on Thai.
Use light/regular display weights; semibold is for labels and hierarchy, not every heading.

## Shapes, spacing and layout

- Radius: 0 for structural areas, 2px for fields/cards, 4px for dialogs/buttons,
  6px only for small icon controls, pill only for small round identity/status elements.
- The reference lists 8px but also excludes it in its guidance; this project omits 8px.
  No 12/16/24px rounded-card visual style.
- Spacing scale: 2, 4, 8, 12, 16, 24, 32, 40, 64px; default form/control gap 12–16px.
- Use borders for separation; minimal shadow and no decorative gradients/glows.
- Desktop: compact navigation/sidebar, top org/account controls, page header, toolbar,
  then content. Use wider content for Kanban than for forms.
- Mobile: collapsible navigation, full-width forms/detail view and ticket list.
  Avoid requiring horizontal board dragging as the only way to work.
- The 33px reference button is a desktop visual cue. Provide at least 44px touch hit
  areas on mobile, even if the visible control is more compact.

## Reusable component contracts

| Component family | Variants / requirements |
|---|---|
| Button | neutral, brand, outline, ghost, danger; pending/disabled; one dominant action per toolbar |
| Form fields | label, description, required, error, disabled; connect labels/errors programmatically |
| Dialog/drawer | focus trap, restore focus, Escape, unsaved-change confirmation where needed |
| Table/list | loading, empty, failed, pagination; sorting/filter state represented consistently |
| Badge | state label + optional icon; color is supplemental |
| FAQ editor | question, answer, category, publish state; explicit save/cancel and preview |
| Kanban ticket | event, type, title, assignee, due date; contact details confined to authorized detail view |
| Toast/inline errors | use inline errors for correction; toast for nonblocking result; no fake success |
| Key display | show once, copy acknowledgment, masked after dismissal, revoke action |
| Template import | CSV/XLSX download, file selection, row preview/errors, explicit commit; no automatic calling |
| Call run | selected recipients, event/date, policy summary, explicit start/pause/cancel |
| Retry timeline | attempt count, confirmed outcome, next retry, unknown/exhausted/stopped states |
| Queue lanes | New / Fail lists with eligible/delayed counts; one Event ratio selector such as 2:1 or 5:1 |
| Queue ratio | X new calls then 1 fail call; durable progress and blocked reason; policy change confirmation |
| Call outcomes | transport answered/no-connection separate from confirm/decline/unknown-with-reason/pending |
| Credential pair | org key + event key relationship, scope/expiry, rotate/revoke; placeholders in examples |

Build component APIs from repeated behavior, not visual similarity alone.
Keep domain policy in hooks/services and compose primitives in feature components.

## Interaction and accessibility state matrix

- Define resting, hover, focus-visible, active, disabled, pending and error states.
- Focus uses a clear blue outline with offset on light/dark surfaces.
- Every form supports keyboard submission, associated errors and pending guard.
- Kanban supports drag/drop and an equivalent move menu/keyboard flow.
- Optimistic board moves roll back on API failure and reload on version conflict.
- Unsaved forms show explicit discard handling on navigation/org switch.
- Imports show the target Event/date throughout preview and confirmation; render phone
  numbers as text. Preserve row errors when users correct and revalidate an upload.
- Call confirmation shows the maximum attempts including the first call. Ambiguous provider
  dispatches show reconciliation; terminal business unknown uses reason-based retry policy.
- Show N N F or N N N N N F as illustrative ratio sequences; unavailable lanes fall
  back to eligible work. Do not present the illustration as a guaranteed next-recipient list.
- An answered call awaiting a final business result remains pending, not confirmed.
- Distinguish a paused queue from an already in-flight call; cancellation must not imply
  that the provider has immediately stopped an active call.
- Motion is short and functional, respects reduced-motion preference and never
  blocks an action while an editorial animation completes.
- Target WCAG AA contrast; verify actual text/background pairs rather than assuming
  all supplied marketing tokens pass for small application text.
- Test Thai wrapping, long event names, long questions, empty lists and dense boards.

## Implementation mapping

- Use Tailwind theme tokens/CSS variables, not repeated raw hex values in JSX.
- `styles/tokens.css` and `styles/base.css` remain small; component variants live
  beside the reusable component and feature composition stays in its module.
- Maintain a component-state gallery/test fixture before building feature screens.
- Acceptance: shared components, Thai text, keyboard flows, loading/error states,
  responsive layouts and `/event-confirm/` deep links all work.
- Keep the current app and the future preview distinguishable until cutover.
