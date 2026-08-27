# Talking Head Pack Gallery

## Mood

Creator-led AI-tool/demo reels: portrait footage as credibility, neutral proof scenes, b-roll receipts, blunt lower-third claims, real-word-onset captions, and centered social CTA endings.

## Palette

Source: `tokens/families/talkingHead.data.ts`.

- Warm white: `TALKING_HEAD.warmWhite` `#F7F2EA`
- Soft paper: `TALKING_HEAD.softPaper` `#EFE7DC`
- Ink: `TALKING_HEAD.ink` `#101114`
- Charcoal: `TALKING_HEAD.charcoal` `#17191D`
- Panel: `TALKING_HEAD.panel` `#24272D`
- Line: `TALKING_HEAD.line` `#D8CEC0`
- Muted: `TALKING_HEAD.muted` `#6B6D73`
- Orange accent: `TALKING_HEAD.orange` `#F46F3A`
- Purple: `TALKING_HEAD.purple` `#7B61FF`
- Green payoff: `TALKING_HEAD.green` `#3B9F6A`
- Red alert: `TALKING_HEAD.red` `#E94B4F`

Fonts: Sora display, JetBrains Mono.

## Components

Base components: `TalkingHeadClaim`, `TalkingHeadProofSplit`, `TalkingHeadToolProof`, `TalkingHeadBrollStack`, `TalkingHeadSocialCTA`, `TalkingHeadCaption`.

Literal/source-specific components: `TalkingHeadPhoneMockStage`, `TalkingHeadAppHeroReveal`, `TalkingHeadPillButtonCallout`, `TalkingHeadCommentCard`, `TalkingHeadFilterAppCard`, `TalkingHeadFunctionModalCard`, `TalkingHeadFeatureChecklist`, `TalkingHeadGradientSwatchCard`, `TalkingHeadSeriesCard`, `TalkingHeadStepTimeline`, `TalkingHeadCompetitorWatchCard`, `TalkingHeadZeroCostCard`, `TalkingHeadPluginRankCard`, `TalkingHeadTerminalCard`.

## House Rules And Known Caveats

- Source clips enter through `sourceClips[]` and `editDecisions[]`; proof media enters through `mediaSlotId`.
- Do not fabricate real creator likenesses. Missing faces use the pack's placeholder mechanism until the buyer supplies licensed clips.
- With a usable source clip, designed elements should occupy about 40% of the frame while leaving room for the person. Without a usable clip, treat the scene like a full-frame graphic and avoid empty portrait space.
- Terminal text, CTA copy, placeholder-card labels, and captions need the shared text-size and caption-band standards.
- A real `COLOR.ink`/`COLOR.paper` inversion bug was found and fixed in this pack; new components should use luminance-aware helpers rather than token-name assumptions.

## Sources Checked

`packs/talking-head/README.md`, `packs/STATUS.md`, `tokens/families/talkingHead.data.ts`, `engine/components/TalkingHeadPack.tsx`.
