package com.awsdocs.domain.model;

public record GalaxyNode(
    String id,
    String label,
    String service,
    String type,        // "document" | "concept" | "cluster"
    double gravityScore // 0.0–1.0, 1.0 = focal node
) {}
