import { serve } from "bun";
import { apiHandler } from "./api";
import index from "./index.html";

const handleApi = (request: Request) => apiHandler(request);

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api": {
      GET: handleApi,
      POST: handleApi,
      PUT: handleApi,
      PATCH: handleApi,
      DELETE: handleApi,
      OPTIONS: handleApi,
    },

    "/api/*": {
      GET: handleApi,
      POST: handleApi,
      PUT: handleApi,
      PATCH: handleApi,
      DELETE: handleApi,
      OPTIONS: handleApi,
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`Server running at ${server.url}`);
