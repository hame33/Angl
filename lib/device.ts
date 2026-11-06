/*
 * iOS (every browser there is Safari underneath) only lets a video start with
 * sound when the tap lands inside the player's own frame. A tap on our page
 * that then loads YouTube's player doesn't count, so the facade costs iPhone
 * visitors a second tap. ClipPlayer uses this to load the real player early on
 * iOS instead.
 *
 * iPadOS reports itself as a Mac, so a "Mac" with a touch screen is an iPad.
 */
export function isIOS(userAgent: string, maxTouchPoints = 0): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}
