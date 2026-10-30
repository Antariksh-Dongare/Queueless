/**
 * Copies only from an explicit user gesture. The Selection API fallback is
 * intentionally retained for HTTP LAN demos, where navigator.clipboard is
 * commonly unavailable because the page is not a secure context.
 */
export async function copyTextFromUserGesture(text: string) {
  if (typeof navigator !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the synchronous, user-gesture based browser fallback.
    }
  }
  if (typeof document === "undefined" || !document.body) return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
