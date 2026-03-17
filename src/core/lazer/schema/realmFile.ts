import Realm from "realm";
import type { ObjectSchema } from "realm";

export class RealmFile extends Realm.Object<RealmFile> {
  Hash?: string;

  static schema: ObjectSchema = {
    name: "File",
    primaryKey: "Hash",
    properties: {
      Hash: { type: "string", default: "", optional: true },
    },
  };
}

