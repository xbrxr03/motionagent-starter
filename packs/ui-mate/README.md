# UI Mate - Style Pack (v1.1)

UI Mate is for UI/UX micro-interaction reels: gestures, validation, optimistic states,
menus, feedback, and small interface patterns. It teaches interaction semantics rather
than product-launch surfaces.


## Shared visual vocabulary

This pack has access to MotionAgent's shared visual primitives: `VoiceOrb`,
`WaveformPanel`, `EditorTimelinePanel`, `AdsDashboard`, `ApprovalShield`,
`InboxTaskList`, `StoryboardGrid`, `BodyAnalyticsMap`, `RecoveryChart`,
`BrowserAgentPanel`, `OddsBoard`, and `CtaPlate`. These are token-driven
and render in this pack's palette/type/motion personality.

## What it ships

- Token family: `uiMate`
- Preset file: `presets/ui-mate.json`
- Example plan: `demo/plan-ui-mate-capability-showcase.json`
- Native Remotion components: 45 registered UI/interaction primitives are exposed in
  `packs/ui-mate/pack.json`. The surface covers gesture/form/optimistic/media
  primitives plus color pickers, command/search states, confirmation dialogs, latency
  gauges, file upload states, undo/delete flows, safe/unsafe lists, and collaboration
  cursor/presence patterns.

## Component vocabulary highlights

Built to a "frame-by-frame identical" fidelity bar for its literal-recreation primitives:
each hero UI moment is a native, literal component rather than a generic placeholder — e.g.
`UiColorSwatchPanel` reproduces a real gradient/hue-slider/hex/swatch-row color picker,
`UiConfirmDialog` reproduces a real "Delete this project?" modal verbatim (title, body copy,
Keep/Delete buttons), `UiCommandList` reproduces a real command-palette's grouped
Recent/Actions/Pages sections.

The pack exposes 45 editable components covering form validation, color picking, command
palettes, file upload, hold-to-confirm, optimistic UI, and multiplayer presence with
multiple distinct UI states.

## v1.1 Director-facing beat grammars

- `validation-teardown`: live error → blur check → escalation → success → CTA.
- `command-and-search`: command list → fuzzy match → keyboard nav → async state → nested
  command → CTA.
- `upload-and-destructive-actions`: drop zone → upload progress → retry → confirm dialog
  → undo countdown → cooldown delete.
- `collaboration-presence`: cursor grid → avatar stack → selection lock → follow mode →
  sync flow → CTA.

## Visual rules

- Dark grid substrate.
- Teal = safe/reveal/instant/success.
- Red/pink = destructive/error/commit.
- Big bold sans headlines with small mono labels.
- Flat UI cards are acceptable only when they show a specific interaction state.
- Screenshots/videos enter through `mediaSlotId`; missing media gets a styled UI placeholder.
- Product-facing docs and demo copy do not expose private inspiration names, handles, or folder tags.
