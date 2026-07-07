package com.awsdocs.adapter.in.rest.dto;

import java.util.List;
import java.util.Map;

public record QueryResponse(
    String id,
    String question,
    String answer,
    List<Map<String, Object>> citations,
    List<Map<String, Object>> relatedDocs,
    Map<String, Object> metadata) {}
