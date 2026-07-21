import { useQuery } from "@tanstack/react-query";
import {
  fetchGraphOverview,
  fetchClusters,
  fetchFocusSubgraph,
} from "@/lib/api";
import type { GalaxyLevel } from "./useGalaxyState";
import type { GraphNode, GraphEdge } from "@/lib/types";

export interface GalaxyGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isLoading: boolean;
  isError: boolean;
}

export function useGalaxyData(level: GalaxyLevel): GalaxyGraphData {
  const overviewQ = useQuery({
    queryKey: ["graph", "overview"],
    queryFn: fetchGraphOverview,
    enabled: level.type === "overview",
    staleTime: 24 * 60 * 60 * 1000,
  });

  const clustersQ = useQuery({
    queryKey: ["galaxy", "clusters"],
    queryFn: fetchClusters,
    enabled: level.type === "cluster" || level.type === "overview",
    staleTime: 60 * 60 * 1000,
  });

  const gravityQ = useQuery({
    queryKey: [
      "galaxy",
      "focus",
      level.type === "gravity" ? level.focalNodeId : "",
    ],
    queryFn: () =>
      level.type === "gravity" ? fetchFocusSubgraph(level.focalNodeId) : null,
    enabled: level.type === "gravity",
    staleTime: 5 * 60 * 1000,
  });

  if (level.type === "gravity" && gravityQ.data) {
    const allNodes: GraphNode[] = [
      {
        id: gravityQ.data.center.id,
        url: "",
        title: gravityQ.data.center.label,
        service: gravityQ.data.center.service,
      },
      ...gravityQ.data.nodes.map((n) => ({
        id: n.id,
        url: "",
        title: n.label,
        service: n.service,
      })),
    ];
    return {
      nodes: allNodes,
      edges: gravityQ.data.edges as GraphEdge[],
      isLoading: gravityQ.isLoading,
      isError: gravityQ.isError,
    };
  }

  // Default: overview
  return {
    nodes: overviewQ.data?.nodes ?? [],
    edges: overviewQ.data?.edges ?? [],
    isLoading: overviewQ.isLoading,
    isError: overviewQ.isError,
  };
}
