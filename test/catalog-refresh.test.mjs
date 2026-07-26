import { expect, test } from "bun:test";

import { emptyMusicCatalog } from "../src/core/api/catalog.ts";
import { createRefreshingCatalogStore } from "../src/core/lazer/library.ts";

test("catalog refreshes only after its source signature changes", async () => {
  let signature = "one";
  let loadCount = 0;
  let nextCatalog = emptyMusicCatalog();

  const store = await createRefreshingCatalogStore({
    getSignature: async () => signature,
    loadCatalog: async () => {
      loadCount += 1;
      return nextCatalog;
    },
  });

  expect(loadCount).toBe(1);
  expect(await store.refreshIfChanged()).toBe(nextCatalog);
  expect(loadCount).toBe(1);

  signature = "two";
  nextCatalog = {
    ...emptyMusicCatalog(),
    artists: [{ id: "artist", name: "Artist" }],
  };

  expect(await store.refreshIfChanged()).toBe(nextCatalog);
  expect(store.getCatalog()).toBe(nextCatalog);
  expect(loadCount).toBe(2);
});

test("a failed refresh retains the last good catalog and remains retryable", async () => {
  let signature = "one";
  let shouldFail = false;
  const warnings = [];
  const original = emptyMusicCatalog();

  const store = await createRefreshingCatalogStore({
    getSignature: async () => signature,
    loadCatalog: async () => {
      if (shouldFail) {
        throw new Error("temporary Realm failure");
      }
      return original;
    },
    onRefreshError: (error) => warnings.push(error),
  });

  signature = "two";
  shouldFail = true;
  expect(await store.refreshIfChanged()).toBe(original);
  expect(warnings).toHaveLength(1);

  shouldFail = false;
  const recovered = await store.refreshIfChanged();
  expect(recovered).toBe(original);
  expect(warnings).toHaveLength(1);
});
