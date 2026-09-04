/**
 * Live mic-level source for the app's one voice orb.
 *
 * Why a ref, not the store: VoiceOrb polls this every animation frame, not
 * through React re-renders — the same pattern VoiceOrb itself already uses
 * internally (`getLevelRef.current = getLevel`). DictationIndicator is the
 * sole mounted owner of real audio capture (agent WebRTC, Jarvis STT, plain
 * dictation), so it publishes whichever getLevel is currently correct here;
 * any other renderer of the orb (the floating terminal dock) reads it
 * without mounting a second, competing capture pipeline.
 */
export const voiceOrbLevelSource: { current: () => number } = { current: () => 0 }
