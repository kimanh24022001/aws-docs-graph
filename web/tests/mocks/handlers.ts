import { http, HttpResponse } from "msw";
import {
  FIXTURE_QUERY_RESPONSE,
  FIXTURE_QUERY_HISTORY,
  FIXTURE_ME,
  FIXTURE_GRAPH_OVERVIEW,
} from "./fixtures";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const handlers = [
  http.post(`${API_BASE}/v1/queries`, () =>
    HttpResponse.json(FIXTURE_QUERY_RESPONSE),
  ),

  http.get(`${API_BASE}/v1/queries`, () =>
    HttpResponse.json(FIXTURE_QUERY_HISTORY),
  ),

  http.get(`${API_BASE}/v1/queries/:id`, ({ params }) => {
    if (params.id === FIXTURE_QUERY_RESPONSE.id) {
      return HttpResponse.json(FIXTURE_QUERY_RESPONSE);
    }
    return HttpResponse.json({ error: "not found" }, { status: 404 });
  }),

  http.get(`${API_BASE}/v1/me`, () => HttpResponse.json(FIXTURE_ME)),

  http.get(`${API_BASE}/v1/graph/overview`, () =>
    HttpResponse.json(FIXTURE_GRAPH_OVERVIEW),
  ),
];
