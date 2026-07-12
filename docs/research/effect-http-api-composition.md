# Effect HTTP API composition in Converge's pinned beta

## Scope

This note examines the Effect `4.0.0-beta.85` pinned by this repository ([`package.json`](../../package.json#L9-L19)) and the matching checked-in Effect source. The question is how a Converge application should compose its HTTP API without introducing a long-lived `PrimaryConverge` object.

## The composition model

Effect separates an HTTP system into four parts:

1. **A declarative contract.** An `HttpApi` is data describing named groups of schema-defined endpoints. The same value drives server routing, generated clients, URLs, OpenAPI, and reflection ([`HttpApi.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApi.ts#L1-L8)). Endpoints declare params, query, headers, payload, success, and error schemas; the constructors add the normal JSON and string-tree codecs ([`HttpApiEndpoint.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts#L1119-L1161)).
2. **One implementation layer per group.** `HttpApiBuilder.group(finalApi, groupName, ...)` produces a layer whose typed handler builder requires every endpoint to be handled ([`HttpApiBuilder.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L106-L153), [`HttpApiBuilder.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L267-L303)). The builder may itself use services, and endpoint effects may require services; those requirements remain visible in the layer type.
3. **A registration layer.** `HttpApiBuilder.layer(finalApi)` reads the group implementation services, converts their handlers into routes, and registers them with the shared `HttpRouter` ([`HttpApiBuilder.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L56-L104)). The application supplies group layers and their dependencies with ordinary `Layer.provide`; Effect's own complete example constructs several group layers and then provides all of them to one API layer ([`HttpApi.test.ts`](../../.agents/effect-smol/packages/platform-node/test/HttpApi.test.ts#L1714-L1823)).
4. **A single runtime boundary.** The application chooses `HttpRouter.serve` for an Effect `HttpServer`, or `HttpRouter.toWebHandler` for a Fetch-compatible host. `toWebHandler` builds the router/layer graph once and returns both `handler` and `dispose`, so scoped resources have an explicit lifetime ([`HttpRouter.ts`](../../.agents/effect-smol/packages/effect/src/unstable/http/HttpRouter.ts#L1272-L1340)). `serve` performs the analogous composition against an `HttpServer` service ([`HttpRouter.ts`](../../.agents/effect-smol/packages/effect/src/unstable/http/HttpRouter.ts#L1215-L1269)).

APIs compose before implementation: `add` adds groups, `addHttpApi` adds another API's groups, and `prefix` transforms all current routes ([`HttpApi.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApi.ts#L57-L83)). Effect tests the intended shape directly: merge an API fragment with `addHttpApi`, attach API-wide middleware, provide each group's handler and middleware layers, then serve one final API layer ([`HttpApi.test.ts`](../../.agents/effect-smol/packages/platform-node/test/HttpApi.test.ts#L562-L631)). Raw route layers can also participate because `HttpRouter.add` / `addAll` are layers that register against the same router service ([`HttpRouter.ts`](../../.agents/effect-smol/packages/effect/src/unstable/http/HttpRouter.ts#L469-L542)).

Middleware that belongs to the contract is attached to an endpoint, group, or API and implemented as a service layer; it can model authentication and request-scoped services on the server and corresponding generated-client behavior ([`HttpApiMiddleware.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts#L1-L10), [`HttpApiMiddleware.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts#L103-L148)). Infrastructure-wide middleware belongs at the router/server boundary. One ordering caveat: API/group `.middleware(...)` affects only endpoints already present at the time it is called ([`HttpApi.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApi.ts#L74-L83)).

The same final declaration derives a client. `HttpApiClient.make` uses an `HttpClient` service and optional base URL, while `HttpApiClient.group` derives only one named group ([`HttpApiClient.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiClient.ts#L452-L545)). Requests and responses therefore use the same schemas as the server rather than a second hand-written wire client. Effect also has first-class schema-driven SSE success streams, including typed stream errors ([`HttpApiSchema.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiSchema.ts#L278-L318), [`HttpApiSchema.ts`](../../.agents/effect-smol/packages/effect/src/unstable/httpapi/HttpApiSchema.ts#L397-L437)).

## Comparison with current Converge HTTP integration

`HttpPrimarySyncEngine.routesLayer` currently hand-registers five raw routes, manually parses requests, manually serializes responses, and exposes a separate hand-written Fetch client ([`http-primary-sync-engine.ts`](../../packages/converge/src/primary-sync-engine/layers/http-primary-sync-engine.ts#L263-L379), [`http-primary-sync-engine.ts`](../../packages/converge/src/primary-sync-engine/layers/http-primary-sync-engine.ts#L385-L502)). This duplicates the contract between server and client and bypasses the typed success/error and middleware model.

The React example correctly composes the route and domain layers, but then owns a Converge-specific web-handler boundary and must forward a fabricated empty context (`{} as never`) plus a separate disposer ([`http.ts`](../../examples/react/api/src/http.ts#L37-L56)). That shape becomes awkward as soon as the application has non-Converge endpoints or shared authentication, observability, CORS, and lifecycle concerns.

## Recommendation for Converge 1.0

Converge should mirror Effect's native composition model:

- Export a **declarative, namespaced sync API fragment**, containing the pull, push, event lookup, projection, and poke/SSE contract. Allow the application to prefix that fragment before merging it into its final API.
- Export a **typed Converge group-handler layer factory** that accepts the application's final composed API plus Converge's primary configuration/business-handler layers. It should implement Converge's group with `HttpApiBuilder.group`; it should not call `serve` or `toWebHandler`.
- Let the application construct one final `AppApi`, merge the Converge fragment with `addHttpApi`, provide its own group layers and Converge's group layer to one `HttpApiBuilder.layer(AppApi)`, and choose the server/web-handler boundary once.
- Derive the replica's HTTP transport from the same declaration with `HttpApiClient.group` (possibly hidden behind a Converge `Layer`), replacing the handwritten Fetch calls.
- Keep `makeWebHandler` only as a testing/convenience wrapper, not the primary application integration API.

Illustrative application shape:

```ts
const SyncApi = ConvergeHttpApi.api.prefix("/api/sync");

const AppApi = HttpApi.make("app").add(AppGroups).addHttpApi(SyncApi);

const AppHttpLive = HttpApiBuilder.layer(AppApi).pipe(
  Layer.provide(AppGroupLive),
  Layer.provide(ConvergeHttpApi.group(AppApi, ConvergePrimaryLive)),
);

export const { handler, dispose } = HttpRouter.toWebHandler(AppHttpLive);
```

The exact factory names remain a design decision, but the topology should be stable: **shared declaration + handler layers + one application-owned runtime boundary**. This is more precise than “factories returning runtimes”: Converge should return composable Effect declarations and layers, while the application owns the runtime. No long-lived Converge instance is needed.
