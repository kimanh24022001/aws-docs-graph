package com.awsdocs.domain.model;

import java.util.UUID;

public record Document(UUID id, String url, String title, String service) {}
