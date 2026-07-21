package com.awsdocs.application.port.out;

import java.util.List;
import java.util.Map;

public interface GraphRepository {
  List<Map<String, Object>> getOverview(int limit);

  List<Map<String, Object>> getNeighbors(String documentId, int hops, int limit);

  Map<String, Object> getDocument(String documentId);

  List<Map<String, Object>> search(String query, int limit);

  List<Map<String, Object>> getClusters();

  List<Map<String, Object>> getServicesInCluster(String communityId);

  List<Map<String, Object>> getConceptsForService(String service);

  Map<String, Object> getFocusSubgraph(String nodeId, int limit);
}
