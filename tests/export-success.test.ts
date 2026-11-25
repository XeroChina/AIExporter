// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://claude.ai/chat/0b2f7a52-1c3d-4e5f-8a9b-0c1d2e3f4a5b"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Covers the brief auto-dismissing success toast shown in the chat
 * page once a download or save completes.
 */

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

const TOAST_ID = "ai-exporter-toast";

const onMessageListeners: Listener[] = [];

async function loadContentScript(
  extensionOrigin = "chrome-extension://test-id/",
  language = "en",
): Promise<void> {
  vi.resetModules();
  onMessageListeners.length = 0;

  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (path: string) => `${extensionOrigin}${path}`,
      getManifest: () => ({ version: "9.8.7" }),
      sendMessage: vi.fn(),
      onMessage: {
        addListener: (listener: Listener) => {
          onMessageListeners.push(listener);
        },
      },
    },
    storage: {
      sync: {
        get: vi.fn((defaults: Record<string, unknown>) =>
          Promise.resolve({ ...defaults, language }),
        ),
      },
      onChanged: { addListener: vi.fn() },
    },
    i18n: { getUILanguage: () => "en-US" },
  });

  await import("../src/content");
  await Promise.resolve();
  await Promise.resolve();
}

function triggerExportSuccess(): HTMLElement {
  for (const listener of onMessageListeners) {
    listener({ type: "SHOW_EXPORT_SUCCESS" }, {}, () => undefined);
  }

  const toast = document.getElementById(TOAST_ID);

  if (!toast) {
    throw new Error("Toast was not shown");
  }

  return toast;
}

describe("export success toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.getElementById(TOAST_ID)?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a brief success toast instead of a modal dialog", async () => {
    await loadContentScript();

    const toast = triggerExportSuccess();

    expect(toast.dataset.tone).toBe("success");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toContain("Export complete");
    expect(document.getElementById("ai-exporter-export-success-overlay")).toBeNull();
  });

  it("auto-dismisses after a short delay", async () => {
    await loadContentScript();

    triggerExportSuccess();
    expect(document.getElementById(TOAST_ID)).not.toBeNull();

    vi.advanceTimersByTime(4000);
    expect(document.getElementById(TOAST_ID)).toBeNull();
  });

  it("uses the chosen language", async () => {
    await loadContentScript("chrome-extension://test-id/", "zh");

    const toast = triggerExportSuccess();

    expect(toast.textContent).toContain("导出完成");
  });

  it("reuses a single toast across repeated exports", async () => {
    await loadContentScript();

    triggerExportSuccess();
    triggerExportSuccess();

    expect(document.querySelectorAll(`#${TOAST_ID}`)).toHaveLength(1);
  });
});
