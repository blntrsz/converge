import path from "node:path";
import { PgliteClient } from "@effect/sql-pglite";
import { String } from "effect";

const dataDir = path.join(import.meta.dirname, "../../../.pglite");

export const PgliteSqlClient = PgliteClient.layer({
  dataDir,
  transformResultNames: String.snakeToCamel,
  transformQueryNames: String.camelToSnake,
});
