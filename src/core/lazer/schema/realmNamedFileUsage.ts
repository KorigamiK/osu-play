import Realm from "realm";
import type { ObjectSchema } from "realm";
import { RealmFile } from "./realmFile.js";

export class RealmNamedFileUsage extends Realm.Object<RealmNamedFileUsage> {
  File!: RealmFile;
  Filename?: string;

  static embedded = true;

  static schema: ObjectSchema = {
    name: "RealmNamedFileUsage",
    embedded: true,
    properties: {
      File: "File",
      Filename: { type: "string", optional: true },
    },
  };
}
