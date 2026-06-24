import { Schema } from "effect";
import { Model } from "effect/unstable/schema";

export class ProjectionsSnapshot extends Model.Class<ProjectionsSnapshot>("ProjectionsSnapshot")({
  accepted: Schema.Record(Schema.String, Schema.Unknown),
  optimistic: Schema.Record(Schema.String, Schema.Unknown),
}) {}
