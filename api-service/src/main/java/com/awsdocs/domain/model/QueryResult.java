package com.awsdocs.domain.model;

import java.util.List;
import java.util.Map;

public record QueryResult(
    String queryId,
    String answer,
    List<Map<String, Object>> citations,
    List<Map<String, Object>> relatedDocs,
    Map<String, Object> metadata) {}
