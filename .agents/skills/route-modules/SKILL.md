---
name: route-modules
description: Route modules in `app/routes/` — registering in `app/routes.ts`, guarding loaders and actions, and what a route component may import. Use when adding, editing, or moving a route module, when `./+types/*` imports fail to resolve, or when a page renders but its buttons do nothing.
---

# Route Modules

Requests flow route → service → Drizzle. A route module owns the HTTP side — loader, action, redirects, status codes — and the component that renders it.

## Registration

Routing is config-based. A module in `app/routes/` is served only once it is registered in `app/routes.ts`, and an unregistered module fails silently: no error, just a 404. Register every new or moved module there. Most pages sit inside the `routes/layout.app.tsx` layout.

## Guards

Loaders and actions are authorised independently. Every mutating action calls a `require*` guard itself, even when the loader on the same route already has one. The guards and when to use each are in the header of `app/lib/access.server.ts`.

## The client bundle

A route module's loader and action run on the server; its component also ships to the browser. Whatever the component uses from `app/services/*` drags `~/db` → `better-sqlite3` into the client bundle.

Put constants and types the component shares with a service in a client-safe module under `app/lib/` — `app/lib/ratings.ts` and `app/lib/comments.ts` are the pattern. The component imports from there; services stay in the loader and action.

The breakage is silent on the server: the page server-renders fine, then hydration crashes ("promisify is not a function") and every button does nothing. After a UI change, check hydration in a real browser — console errors, interactive buttons — since server-rendered HTML fetched with curl looks correct either way.

## Route types

Route modules import generated types from `./+types/<route-file-name>`. These come from `react-router typegen`, so check types with `npm run typecheck`, which runs typegen before `tsc`. Bare `tsc` reports the `+types` imports as missing.
