import { describe, expect, test } from "bun:test";

import {
  formatLazerSchemaCompatibilityError,
  inspectLazerSchemaEntries,
} from "../src/core/lazer/compat.ts";

const compatibleSchema = [
  {
    name: "BeatmapSet",
    properties: {
      Beatmaps: { type: "list", objectType: "Beatmap" },
      Files: { type: "list", objectType: "RealmNamedFileUsage" },
    },
  },
  {
    name: "Beatmap",
    properties: {
      Metadata: { type: "object", objectType: "BeatmapMetadata" },
    },
  },
  {
    name: "BeatmapMetadata",
    properties: {
      AudioFile: { type: "string" },
      Title: { type: "string" },
      Artist: { type: "string" },
      TitleUnicode: { type: "string" },
      ArtistUnicode: { type: "string" },
    },
  },
  {
    name: "RealmNamedFileUsage",
    properties: {
      File: { type: "object", objectType: "File" },
      Filename: { type: "string" },
    },
  },
  {
    name: "File",
    properties: {
      Hash: { type: "string" },
    },
  },
];

describe("lazer schema compatibility", () => {
  test("accepts schema versions that keep the playlist fields stable", () => {
    const report = inspectLazerSchemaEntries(compatibleSchema, 51);

    expect(report.compatible).toBe(true);
    expect(report.version).toBe(51);
    expect(report.missingObjects).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  test("reports missing or changed fields clearly", () => {
    const report = inspectLazerSchemaEntries(
      compatibleSchema.map((entry) =>
        entry.name === "BeatmapMetadata"
          ? {
              ...entry,
              properties: {
                ...entry.properties,
                AudioFile: { type: "list", objectType: "string" },
              },
            }
          : entry.name === "File"
            ? {
                ...entry,
                properties: {},
              }
            : entry,
      ),
      99,
    );

    expect(report.compatible).toBe(false);
    expect(report.issues).toEqual([
      {
        objectName: "BeatmapMetadata",
        propertyName: "AudioFile",
        expected: "string",
        actual: "list:string",
      },
      {
        objectName: "File",
        propertyName: "Hash",
        expected: "string",
        actual: "missing",
      },
    ]);
    expect(formatLazerSchemaCompatibilityError(report)).toMatch(/schema version 99/);
  });
});
