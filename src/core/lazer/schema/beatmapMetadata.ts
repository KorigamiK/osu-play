import Realm from "realm";
import type { ObjectSchema } from "realm";
import { RealmUser } from "./realmUser.js";

export class BeatmapMetadata extends Realm.Object<BeatmapMetadata> {
  Title?: string;
  TitleUnicode?: string;
  Artist?: string;
  ArtistUnicode?: string;
  Author?: RealmUser;
  Source?: string;
  Tags?: string;
  PreviewTime?: number;
  AudioFile?: string;
  BackgroundFile?: string;

  static schema: ObjectSchema = {
    name: "BeatmapMetadata",
    properties: {
      Title: { type: "string", default: "", optional: true },
      TitleUnicode: { type: "string", default: "", optional: true },
      Artist: { type: "string", default: "", optional: true },
      ArtistUnicode: { type: "string", default: "", optional: true },
      Author: { type: "object", objectType: "RealmUser", default: null },
      Source: { type: "string", default: "", optional: true },
      Tags: { type: "string", default: "", optional: true },
      PreviewTime: { type: "int", default: 0 },
      AudioFile: { type: "string", default: "", optional: true },
      BackgroundFile: { type: "string", default: "", optional: true },
    },
  };
}
