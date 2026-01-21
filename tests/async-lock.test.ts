import { describe, it, expect } from "vitest";
import { AsyncKeyedLock } from "../src/utils/async-lock.js";

describe("AsyncKeyedLock", () => {
  it("serializes acquisitions for the same key", async () => {
    const lock = new AsyncKeyedLock();
    const order: string[] = [];

    const release1 = await lock.acquire("key");
    order.push("acquired-1");

    const acquire2 = (async () => {
      const release2 = await lock.acquire("key");
      order.push("acquired-2");
      release2();
    })();

    await Promise.resolve();
    expect(order).toEqual(["acquired-1"]);

    release1();
    await acquire2;
    expect(order).toEqual(["acquired-1", "acquired-2"]);
  });

  it("does not block different keys", async () => {
    const lock = new AsyncKeyedLock();
    const order: string[] = [];

    const releaseA = await lock.acquire("a");
    const releaseB = await lock.acquire("b");

    order.push("a", "b");
    releaseA();
    releaseB();

    expect(order).toEqual(["a", "b"]);
  });
});
