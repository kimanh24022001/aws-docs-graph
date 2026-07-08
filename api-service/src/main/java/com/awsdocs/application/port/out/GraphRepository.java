package com.awsdocs.application.port.out;

import java.util.List;
import java.util.Map;

public interface GraphRepository {
  List<Map<String, Object>> getOverview(int limit);

  List<Map<String, Object>> getNeighbors(String documentId, int hops, int limit);

  Map<String, Object> getDocument(String documentId);

  List<Map<String, Object>> search(String query, int limit);
}
