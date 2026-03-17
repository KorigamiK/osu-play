import Realm from "realm";
import type { ObjectSchema } from "realm";
import { BeatmapMetadata } from "./beatmapMetadata.js";

export class Beatmap extends Realm.Object<Beatmap> {
  ID!: string;
  DifficultyName?: string;
  Metadata!: BeatmapMetadata;
  BeatmapSet!: any;
  Status!: number;
  OnlineID!: number;
  Length!: number;
  BPM!: number;
  Hash?: string;
  StarRating!: number;
  MD5Hash?: string;
  OnlineMD5Hash?: string;
  LastLocalUpdate?: Date;
  LastOnlineUpdate?: Date;
  Hidden!: boolean;
  AudioLeadIn!: number;
  StackLeniency!: number;
  SpecialStyle!: boolean;
  LetterboxInBreaks!: boolean;
  WidescreenStoryboard!: boolean;
  EpilepsyWarning!: boolean;
  SamplesMatchPlaybackRate!: boolean;
  LastPlayed?: Date;
  DistanceSpacing!: number;
  BeatDivisor!: number;
  GridSize!: number;
  TimelineZoom!: number;
  EditorTimestamp?: number;
  CountdownOffset!: number;

  static schema: ObjectSchema = {
    name: "Beatmap",
    primaryKey: "ID",
    properties: {
      ID: { type: "uuid", default: "" },
      DifficultyName: { type: "string", default: "", optional: true },
      Metadata: {
        type: "object",
        objectType: "BeatmapMetadata",
        default: null,
      },
      BeatmapSet: { type: "object", objectType: "BeatmapSet", default: null },
      Status: { type: "int", default: -3 },
      OnlineID: { type: "int", default: -1 },
      Length: { type: "double", default: 0 },
      BPM: { type: "double", default: 0 },
      Hash: { type: "string", default: "", optional: true },
      StarRating: { type: "double", default: -1 },
      MD5Hash: { type: "string", default: "", optional: true },
      OnlineMD5Hash: { type: "string", default: "", optional: true },
      LastLocalUpdate: { type: "date", optional: true },
      LastOnlineUpdate: { type: "date", optional: true },
      Hidden: { type: "bool", default: false },
      AudioLeadIn: { type: "double", default: 0 },
      StackLeniency: { type: "float", default: 0.7 },
      SpecialStyle: { type: "bool", default: false },
      LetterboxInBreaks: { type: "bool", default: false },
      WidescreenStoryboard: { type: "bool", default: false },
      EpilepsyWarning: { type: "bool", default: false },
      SamplesMatchPlaybackRate: { type: "bool", default: false },
      LastPlayed: { type: "date", optional: true },
      DistanceSpacing: { type: "double", default: 0 },
      BeatDivisor: { type: "int", default: 0 },
      GridSize: { type: "int", default: 0 },
      TimelineZoom: { type: "double", default: 0 },
      EditorTimestamp: { type: "double", optional: true },
      CountdownOffset: { type: "int", default: 0 },
    },
  };
}
