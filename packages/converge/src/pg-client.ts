import { PgClient } from "@effect/sql-pg";
import { Config, String } from "effect";

/**
 * @internal
 */
export const PgSqlClient = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  transformResultNames: Config.succeed(String.snakeToCamel),
  transformQueryNames: Config.succeed(String.camelToSnake),
});
