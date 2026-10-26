// Why: a plain empty-canvas drag selects (marquee), so "the user moved the
// camera" can no longer be read off pointerdown. The canvas dispatches this
// event (bubbling) when a pointer pan starts: Space+drag or middle-button drag.
export const BOARD_USER_PAN_EVENT = 'board:user-pan'
