# Task 02 — Background Music, Separate Mute Controls, and Animated Menu

## Goal
Add a background-music system designed for three audio files that the owner will supply later, while preserving the existing pat/voice/content effects.

## Inspect first
- `public/index.html` for current topbar, mute button, record button, leaderboard, and script order.
- `public/js/fx.js` for current Web Audio loading, content/SFX/voice mute state, `muteBtn`, and initialization.
- `public/js/app.js` for game and leaderboard controls.
- `public/css/style.css` for existing visual design and responsive rules.

## Requirements
1. Implement three configurable background-music tracks. The owner will add the audio assets; do not download, invent, or generate audio files.
2. Keep a central track list with filename and display title. Use clear placeholder names such as `/assets/audio/music-01.mp3`, `/assets/audio/music-02.mp3`, and `/assets/audio/music-03.mp3`, unless the repository already has a naming convention that should be preserved. Document the exact expected filenames.
3. Randomly choose a track, avoid immediately replaying the same track when multiple tracks are available, and show the track title briefly in a subtle toast/now-playing label. The toast must not obstruct the game or remain stuck on screen.
4. Respect browser autoplay policies: initialize/resume music only after an explicit user gesture. If a file is missing or playback is rejected, fail gracefully and allow the rest of the game to continue. Do not spam the console with repeated 404 errors.
5. Provide two distinct controls:
   - **Content/SFX mute**: existing pat sounds and voice lines, controlled by the current `fx.js` mute system.
   - **Music mute**: background music only.
   Muting one must not mute/unmute the other. Persist their settings independently.
6. Consolidate secondary actions into one compact menu/dropdown. Include the controls that already exist (record/stamps, content mute, leaderboard if appropriate) and the new music mute plus creator/about link. Do not remove important functionality.
7. The creator/about action must open `https://deni26.my.id/` in a new tab/window safely (`rel="noopener noreferrer"` where applicable).
8. Animate dropdown opening and closing. Keep keyboard support, `aria-expanded`, accessible labels, Escape-to-close, focus-visible styles, and reduced-motion behavior.
9. Ensure clicking a menu item does not count as a character pat and does not trigger unrelated stage actions. Menu should not cover the character's face on common mobile sizes.
10. Preserve the existing visual language: dark ink background, paper/red/ember accents, hard-edged styling. Do not add generic gradients, blur, pill-shaped UI, or emoji.
11. Keep stable IDs or update every reference consistently. Avoid duplicate IDs and avoid coupling music mute state to `fx.js` content mute state.

## Acceptance tests
- Each of the three configured music tracks can be selected and plays after a user gesture.
- Track selection is random and avoids immediate repeat when more than one valid track exists.
- Track title appears briefly and disappears.
- Music mute silences only background music; content mute silences only game SFX/voice.
- Both preferences persist independently after reload.
- Missing music assets do not break pat sounds, voice lines, record dialog, or menu.
- Menu works with mouse, touch, keyboard, Escape, and reduced-motion preference.

## Deliverables
Implement the UI and behavior; document the expected filenames and where to place the owner's assets.
