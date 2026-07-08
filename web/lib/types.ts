export interface Citation {
  rank: number;
  title: string;
  url: string;
  service: string;
  snippet: string | null;
  score: number;
  source_kind: "mcp_search" | "graph_traversal";
}

export interface RelatedDoc {
  title: string;
  url: string;
  service: string;
  hop_count: number;
  edge_path: string[];
}

export interface QueryMetadata {
  duration_ms: number;
  cost_usd: number;
  degraded: boolean;
  truncated: boolean;
  mcp_unavailable?: boolean;
  neo4j_unavailable?: boolean;
  synthesis_failed?: boolean;
}

export interface QueryResponse {
  id: string;
  question: string;
  answer: string | null;
  citations: Citation[];
  related_docs: RelatedDoc[];
  metadata: QueryMetadata;
  created_at: string;
}

export interface QueryHistoryResponse {
  queries: QueryResponse[];
  next_cursor: string | null;
}

export interface MeResponse {
  id: string;
  display_name: string | null;
  daily_cost_usd: number;
}

export interface GraphNode {
  id: string;
  url: string;
  title: string | null;
  service: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "LINKS_TO" | "PREV_NEXT" | "CO_RETURNED";
}

export interface GraphOverviewResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DocumentResponse {
  id: string;
  url: string;
  title: string | null;
  service: string | null;
  wordCount: number | null;
}

export type DocumentNeighborsResponse = GraphNode[];
