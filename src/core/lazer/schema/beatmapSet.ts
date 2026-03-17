import Realm from "realm";
import type { ObjectSchema } from "realm";
import { Beatmap } from "./beatmap.js";
import { RealmNamedFileUsage } from "./realmNamedFileUsage.js";

export class BeatmapSet extends Realm.Object<BeatmapSet> {
  ID!: string;
  OnlineID!: number;
  DateAdded!: Date;
  DateSubmitted?: Date;
  DateRanked?: Date;
  Beatmaps!: Realm.List<Beatmap>;
  Files!: Realm.List<RealmNamedFileUsage>;
  Status!: number;
  DeletePending!: boolean;
  Hash?: string;
  Protected!: boolean;

  static schema: ObjectSchema = {
    name: "BeatmapSet",
    primaryKey: "ID",
    properties: {
      ID: { type: "uuid", default: "" },
      OnlineID: { type: "int", default: -1 },
      DateAdded: { type: "date" },
      DateSubmitted: { type: "date", optional: true },
      DateRanked: { type: "date", optional: true },
      Beatmaps: { type: "list", objectType: "Beatmap", default: [] },
      Files: { type: "list", objectType: "RealmNamedFileUsage", default: [] },
      Status: { type: "int", default: -3 },
      DeletePending: { type: "bool", default: false },
      Hash: { type: "string", default: "", optional: true },
      Protected: { type: "bool", default: false },
    },
  };
}
