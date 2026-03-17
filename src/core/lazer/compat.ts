type SchemaPropertyLike = {
  type?: string;
  objectType?: string;
};

type SchemaEntryLike = {
  name: string;
  properties: Record<string, SchemaPropertyLike>;
};

type RequiredSchemaShape = Record<
  string,
  Record<string, { type?: string; objectType?: string }>
>;

export type LazerSchemaCompatibilityIssue = {
  objectName: string;
  propertyName: string;
  expected: string;
  actual: string;
};

export type LazerSchemaCompatibilityReport = {
  compatible: boolean;
  version: number;
  missingObjects: string[];
  issues: LazerSchemaCompatibilityIssue[];
};

export const LAST_STATIC_LAZER_SCHEMA_VERSION = 46;

const REQUIRED_PLAYLIST_SCHEMA: RequiredSchemaShape = {
  BeatmapSet: {
    Beatmaps: { type: "list", objectType: "Beatmap" },
    Files: { type: "list", objectType: "RealmNamedFileUsage" },
  },
  Beatmap: {
    Metadata: { type: "object", objectType: "BeatmapMetadata" },
  },
  BeatmapMetadata: {
    AudioFile: { type: "string" },
    Title: { type: "string" },
    Artist: { type: "string" },
    TitleUnicode: { type: "string" },
    ArtistUnicode: { type: "string" },
  },
  RealmNamedFileUsage: {
    File: { type: "object", objectType: "File" },
    Filename: { type: "string" },
  },
  File: {
    Hash: { type: "string" },
  },
};

function describeRequirement(requirement: { type?: string; objectType?: string }) {
  if (requirement.type === "object" || requirement.type === "list") {
    return `${requirement.type}:${requirement.objectType ?? "unknown"}`;
  }

  return requirement.type ?? "unknown";
}

function describeProperty(property: SchemaPropertyLike | undefined) {
  if (!property?.type) {
    return "missing";
  }

  if (property.type === "object" || property.type === "list") {
    return `${property.type}:${property.objectType ?? "unknown"}`;
  }

  return property.type;
}

export function inspectLazerSchemaEntries(
  schemaEntries: SchemaEntryLike[],
  version: number,
): LazerSchemaCompatibilityReport {
  const schemaByName = new Map(schemaEntries.map((entry) => [entry.name, entry]));
  const missingObjects: string[] = [];
  const issues: LazerSchemaCompatibilityIssue[] = [];

  for (const [objectName, requirements] of Object.entries(REQUIRED_PLAYLIST_SCHEMA)) {
    const schemaEntry = schemaByName.get(objectName);
    if (!schemaEntry) {
      missingObjects.push(objectName);
      continue;
    }

    for (const [propertyName, requirement] of Object.entries(requirements)) {
      const property = schemaEntry.properties[propertyName];
      const typeMatches = !requirement.type || property?.type === requirement.type;
      const objectTypeMatches =
        !requirement.objectType || property?.objectType === requirement.objectType;

      if (!typeMatches || !objectTypeMatches) {
        issues.push({
          objectName,
          propertyName,
          expected: describeRequirement(requirement),
          actual: describeProperty(property),
        });
      }
    }
  }

  return {
    compatible: missingObjects.length === 0 && issues.length === 0,
    version,
    missingObjects,
    issues,
  };
}

export function formatLazerSchemaCompatibilityError(
  report: LazerSchemaCompatibilityReport,
) {
  const details = [
    `Detected osu!lazer schema version ${report.version}, but the playlist reader is missing fields it needs.`,
  ];

  if (report.missingObjects.length > 0) {
    details.push(`Missing objects: ${report.missingObjects.join(", ")}`);
  }

  if (report.issues.length > 0) {
    details.push(
      `Mismatched properties: ${report.issues
        .map(
          (issue) =>
            `${issue.objectName}.${issue.propertyName} expected ${issue.expected}, got ${issue.actual}`,
        )
        .join("; ")}`,
    );
  }

  details.push(
    "This app now reflects the live lazer schema and only depends on a small playlist-safe subset, so version bumps are fine until those required fields change.",
  );

  return details.join("\n");
}
