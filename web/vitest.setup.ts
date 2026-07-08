import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./tests/mocks/server";

// Restore native fetch (undici) so MSW can intercept via ClientRequest.
// happy-dom replaces globalThis.fetch with its own incompatible implementation.
const { fetch, Request, Response, Headers } = await import("undici");
Object.assign(globalThis, { fetch, Request, Response, Headers });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
