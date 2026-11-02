/** Explicit user action only. Keep private access values out of errors and logs. */
export async function copyOverlayAccessLink(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
