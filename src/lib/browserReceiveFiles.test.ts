import { describe, expect, it } from "vitest";
import { browserReceiveFileKey } from "./browserReceiveFiles";

describe("browserReceiveFileKey", () => {
  it("keeps duplicate-content collection entries independently saveable", () => {
    const hash = "same-content-hash";
    expect(browserReceiveFileKey(hash, 0)).not.toBe(
      browserReceiveFileKey(hash, 1),
    );
  });
});
