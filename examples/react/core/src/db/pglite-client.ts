import { PgliteClient } from "@effect/sql-pglite";
import { String } from "effect";

export const PgliteSqlClient = PgliteClient.layer({
  transformResultNames: String.snakeToCamel,
  transformQueryNames: String.camelToSnake,
});
