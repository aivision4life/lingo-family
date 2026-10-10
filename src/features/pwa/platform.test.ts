import { describe, expect, it } from "vitest";
import { installMode, isIos, isStandalone } from "./platform";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("isIos", () => {
  it("detects iPhone and iPad user agents", () => {
    expect(isIos({ userAgent: IPHONE })).toBe(true);
    expect(isIos({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)" })).toBe(true);
  });

  it("detects iPadOS Safari (Mac user agent + touch screen) but not a real Mac or Android", () => {
    expect(isIos({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("isStandalone / installMode", () => {
  it("standalone via display-mode or iOS navigator.standalone", () => {
    expect(isStandalone({ displayModeStandalone: true })).toBe(true);
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ displayModeStandalone: false })).toBe(false);
  });

  it("installed beats everything; then the browser prompt; then iOS steps; else the browser menu", () => {
    expect(installMode({ standalone: true, hasPrompt: true, ios: true })).toBe("installed");
    expect(installMode({ standalone: false, hasPrompt: true, ios: false })).toBe("prompt");
    expect(installMode({ standalone: false, hasPrompt: false, ios: true })).toBe("ios");
    expect(installMode({ standalone: false, hasPrompt: false, ios: false })).toBe("other");
  });
});
