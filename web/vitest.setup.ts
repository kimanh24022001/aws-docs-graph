import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./tests/mocks/server";

// Restore Node.js native fetch (undici) so MSW can intercept it correctly.
// happy-dom replaces globalThis.fetch with its own implementation whose
// ReadableStream is incompatible with @mswjs/interceptors response cloning.
// Node 18+ ships undici fetch which MSW intercepts via ClientRequest.
// We import it here before happy-dom has a chance to register, but since
// vitest runs the env setup before the setup files we must force-restore it.
const {
  fetch: nativeFetch,
  Request: nativeRequest,
  Response: nativeResponse,
  Headers: nativeHeaders,
} = await import("undici");

Object.assign(globalThis, {
  fetch: nativeFetch,
  Request: nativeRequest,
  Response: nativeResponse,
  Headers: nativeHeaders,
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
