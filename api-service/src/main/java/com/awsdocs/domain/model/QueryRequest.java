package com.awsdocs.domain.model;

public record QueryRequest(String userId, String orgId, String question, String idempotencyKey) {}
