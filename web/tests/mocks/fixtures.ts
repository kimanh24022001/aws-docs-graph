import type {
  QueryResponse,
  QueryHistoryResponse,
  MeResponse,
  GraphOverviewResponse,
} from "@/lib/types";

export const FIXTURE_QUERY_RESPONSE: QueryResponse = {
  id: "q_01HX000000000000000000",
  question: "How do I tag ECS resources for cost allocation?",
  answer:
    "To tag ECS resources for cost allocation, you add tags during resource creation [1]. Then activate the tags in the Billing console [2].",
  citations: [
    {
      rank: 1,
      title: "Tagging Amazon ECS resources",
      url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html",
      service: "ECS",
      snippet:
        "You can tag most Amazon ECS resources when they are created or later.",
      score: 0.91,
      source_kind: "mcp_search",
    },
    {
      rank: 2,
      title: "Activating user-defined cost allocation tags",
      url: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html",
      service: "Billing",
      snippet:
        "You must activate cost allocation tags before they appear in Cost Explorer.",
      score: 0.87,
      source_kind: "mcp_search",
    },
  ],
  related_docs: [
    {
      title: "AWS Cost Explorer",
      url: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html",
      service: "Billing",
      hop_count: 1,
      edge_path: ["LINKS_TO"],
    },
  ],
  metadata: {
    duration_ms: 8420,
    cost_usd: 0.006,
    degraded: false,
    truncated: false,
  },
  created_at: "2026-07-06T10:00:00Z",
};

export const FIXTURE_QUERY_MCP_DOWN: QueryResponse = {
  ...FIXTURE_QUERY_RESPONSE,
  id: "q_02HX000000000000000000",
  answer: null,
  citations: [],
  metadata: {
    ...FIXTURE_QUERY_RESPONSE.metadata,
    degraded: true,
    mcp_unavailable: true,
  },
};

export const FIXTURE_QUERY_NEO4J_DOWN: QueryResponse = {
  ...FIXTURE_QUERY_RESPONSE,
  id: "q_03HX000000000000000000",
  related_docs: [],
  metadata: {
    ...FIXTURE_QUERY_RESPONSE.metadata,
    degraded: true,
    neo4j_unavailable: true,
  },
};

export const FIXTURE_QUERY_SYNTHESIS_FAILED: QueryResponse = {
  ...FIXTURE_QUERY_RESPONSE,
  id: "q_04HX000000000000000000",
  answer: null,
  metadata: {
    ...FIXTURE_QUERY_RESPONSE.metadata,
    degraded: true,
    synthesis_failed: true,
  },
};

export const FIXTURE_QUERY_HISTORY: QueryHistoryResponse = {
  queries: [FIXTURE_QUERY_RESPONSE],
  next_cursor: null,
};

export const FIXTURE_ME: MeResponse = {
  id: "user_01HX000000000000000000",
  display_name: "Test User",
  daily_cost_usd: 0.12,
};

export const FIXTURE_GRAPH_OVERVIEW: GraphOverviewResponse = {
  nodes: [
    {
      id: "doc_01",
      url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html",
      title: "Tagging Amazon ECS resources",
      service: "ECS",
    },
    {
      id: "doc_02",
      url: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html",
      title: "AWS Cost Explorer",
      service: "Billing",
    },
  ],
  edges: [{ source: "doc_01", target: "doc_02", type: "LINKS_TO" }],
};
