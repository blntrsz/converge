import { serve } from "bun";
import index from "./index.html";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";
const hostname = process.env.UI_HOST ?? "localhost";
const port = Number(process.env.UI_PORT ?? process.env.PORT ?? 3000);

const apiMethods = {
  GET: proxyApi,
  POST: proxyApi,
  PUT: proxyApi,
  PATCH: proxyApi,
  DELETE: proxyApi,
  OPTIONS: proxyApi,
};

const server = serve({
  hostname,
  port,
  routes: {
    "/api": apiMethods,
    "/api/*": apiMethods,
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`UI server running at ${server.url}`);
console.log(`Proxying /api to ${apiOrigin}`);

function proxyApi(request: Request) {
  const requestUrl = new URL(request.url);
  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
}
