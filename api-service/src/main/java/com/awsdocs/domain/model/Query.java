package com.awsdocs.domain.model;

import java.time.Instant;
import java.util.UUID;

public record Query(
    UUID id,
    String userId,
    String orgId,
    String question,
    String status,
    String answer,
    Instant createdAt) {}
