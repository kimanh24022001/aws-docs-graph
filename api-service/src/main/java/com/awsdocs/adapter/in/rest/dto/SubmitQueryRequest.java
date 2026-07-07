package com.awsdocs.adapter.in.rest.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SubmitQueryRequest(
    @NotBlank @Size(min = 1, max = 2000) String question, String idempotencyKey) {}
