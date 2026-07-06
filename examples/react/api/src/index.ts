import { serve } from "bun";
import { apiHandler } from "./http";

const port = Number(process.env.API_PORT ?? 3001);
const hostname = process.env.API_HOST ?? "localhost";

const server = serve({
  hostname,
  port,
  fetch: apiHandler,
});

console.log(`API server running at ${server.url}`);
