import { describe, expect, it } from "vitest";
import { selectOngoingTransferIds } from "./transferSelectors";
import type { TransferEntry } from "./transferStore";

describe("selectOngoingTransferIds", () => {
  it("keeps starting, running, and paused transfers in store order", () => {
    const transfers: Record<
      string,
      Pick<TransferEntry, "transferId" | "status">
    > = {
      first: { transferId: "first", status: "starting" },
      second: { transferId: "second", status: "running" },
      third: { transferId: "third", status: "paused" },
      fourth: { transferId: "fourth", status: "completed" },
      fifth: { transferId: "fifth", status: "failed" },
      sixth: { transferId: "sixth", status: "prepared" },
    };

    expect(selectOngoingTransferIds(transfers)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("returns an empty list when there is no visible transfer", () => {
    expect(
      selectOngoingTransferIds({
        done: { transferId: "done", status: "completed" },
      }),
    ).toEqual([]);
  });
});
