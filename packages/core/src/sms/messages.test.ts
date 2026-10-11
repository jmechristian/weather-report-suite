import { describe, expect, it } from "vitest";
import { isHotKeyword, isStopMessage, normalizeSmsPhone, renderSmsTemplate } from "./messages";

describe("sms messages", () => {
  it("normalizes US numbers", () => {
    expect(normalizeSmsPhone("(540) 555-0100")).toBe("+15405550100");
    expect(normalizeSmsPhone("+1 540 555 0100")).toBe("+15405550100");
    expect(normalizeSmsPhone("nope")).toBeNull();
  });

  it("detects carrier opt-out words only as the whole message", () => {
    expect(isStopMessage("stop")).toBe(true);
    expect(isStopMessage("STOPALL")).toBe(true);
    expect(isStopMessage("please stop by")).toBe(false);
  });

  it("matches a hot keyword on the whole reply or the first word", () => {
    expect(isHotKeyword("yes", ["YES"])).toBe(true);
    expect(isHotKeyword("YES please", ["YES"])).toBe(true);
    expect(isHotKeyword("stop", ["YES", "STOP"])).toBe(false);
    expect(isHotKeyword("not interested", ["INTERESTED"])).toBe(false);
  });

  it("fills owner, address, and reply", () => {
    expect(
      renderSmsTemplate("Hi {owner} at {address}: {reply}", {
        owner: "Ada Lovelace",
        address: "1 Main",
        reply: "YES",
      }),
    ).toBe("Hi Ada at 1 Main: YES");
  });
});
