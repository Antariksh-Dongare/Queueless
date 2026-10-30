import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextFromUserGesture } from "../src/clipboard.js";

function installClipboardDom(copyResult: boolean) {
  const field = { value: "", style: { cssText: "" }, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("window", { isSecureContext: false });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", { body: { appendChild: vi.fn() }, createElement: vi.fn(() => field), execCommand: vi.fn(() => copyResult) });
  return field;
}

afterEach(() => vi.unstubAllGlobals());

describe("demo proof clipboard fallback", () => {
  it("uses the selection fallback on an insecure HTTP LAN origin", async () => {
    const field = installClipboardDom(true);
    await expect(copyTextFromUserGesture("signed-proof")).resolves.toBe(true);
    expect(field.value).toBe("signed-proof");
    expect(field.select).toHaveBeenCalledOnce();
    expect(field.remove).toHaveBeenCalledOnce();
  });

  it("reports copy unavailability instead of claiming success", async () => {
    installClipboardDom(false);
    await expect(copyTextFromUserGesture("signed-proof")).resolves.toBe(false);
  });
});
