# UI Mate Pack Gallery

## Mood

Dark, native-drawn UI/UX micro-interaction teaching reels: gestures, validation, optimistic states, command palettes, uploads, destructive confirmation, latency, and multiplayer cursor presence.

## Palette

Source: `tokens/families/uiMate.data.ts`.

- Background: `UI_MATE.bg` `#070B10`
- Surface: `UI_MATE.surface` `#101820`
- Panel: `UI_MATE.panel` `#17232D`
- Line: `UI_MATE.line` `#20323B`
- Text: `UI_MATE.text` `#F5FBFF`
- Muted: `UI_MATE.muted` `#9DB0B7`
- Faint: `UI_MATE.faint` `#51646D`
- Teal accent: `UI_MATE.teal` `#00CDB8`
- Red alert: `UI_MATE.red` `#F0525F`
- Yellow: `UI_MATE.yellow` `#FFCE5C`
- Pink: `UI_MATE.pink` `#FF6A9A`
- Green payoff: `UI_MATE.green` `#47D678`

Fonts: Sora display, JetBrains Mono.

## Components

Base components: `UiSwipeThreshold`, `UiFormValidation`, `UiOptimisticAction`, `UiInteractionSurface`, `UiMateCTA`.

First literal primitives: `UiColorSwatchPanel`, `UiCommandList`, `UiConfirmDialog`, `UiCompareCards`, `UiCursorPresenceGrid`, `UiIdentityFlow`, `UiLatencyGauge`, `UiDropZonePair`, `UiHoldProgressRing`.

Full-density UI-state components and variants: `UiFormStateCard`, `UiFormLiveErrorCard`, `UiFormBlurCheckCard`, `UiFormEscalateCard`, `UiFormSuccessCard`, `UiFormatTabsCard`, `UiOklchSliderCard`, `UiContrastCheckCard`, `UiLightDarkPreviewCard`, `UiScaleGenerationCard`, `UiPaletteTriggerCard`, `UiFuzzyMatchCard`, `UiKeyboardNavList`, `UiAsyncSpinnerRow`, `UiNestedCommandCard`, `UiUploadProgressCard`, `UiUploadErrorRetryCard`, `UiFilePreviewCard`, `UiMultiFileListCard`, `UiCountdownUndoRing`, `UiSettingsDangerCard`, `UiCooldownDeleteCard`, `UiRaceCompareCard`, `UiSyncFlowDiagram`, `UiRollbackToastCard`, `UiSafeUnsafeListCard`, `UiCanvasCursorHero`, `UiInterpolationCompareCard`, `UiPresenceAvatarStackCard`, `UiSelectionLockCard`, `UiFollowModeCard`.

## House Rules And Known Caveats

- UI Mate teaches interaction semantics, not product-launch surfaces.
- Dark substrate with white-on-dark UI elements is now the preferred contrast direction.
- Teal means safe/reveal/instant/success; red/pink means destructive/error/commit.
- Flat UI cards are acceptable only when they show a specific interaction state.
- Captions are wired into the selected targets; avoid caption/footer collisions.
- Context-menu, OTP, password-strength, and pagination components remain open vocabulary gaps.

## Sources Checked

`packs/ui-mate/README.md`, `tokens/families/uiMate.data.ts`, `engine/components/UiMatePack.tsx`.
