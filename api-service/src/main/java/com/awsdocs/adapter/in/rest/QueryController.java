package com.awsdocs.adapter.in.rest;

import com.awsdocs.adapter.in.rest.dto.QueryResponse;
import com.awsdocs.adapter.in.rest.dto.SubmitQueryRequest;
import com.awsdocs.application.port.in.SubmitQueryUseCase;
import com.awsdocs.domain.model.QueryRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/queries")
public class QueryController {

  private final SubmitQueryUseCase submitQueryUseCase;

  public QueryController(SubmitQueryUseCase submitQueryUseCase) {
    this.submitQueryUseCase = submitQueryUseCase;
  }

  @PostMapping
  public ResponseEntity<QueryResponse> submit(
      @Valid @RequestBody SubmitQueryRequest body, HttpServletRequest request) {
    var userId = request.getHeader("X-User-Id");
    var orgId = request.getHeader("X-Org-Id");

    var result =
        submitQueryUseCase.submit(
            new QueryRequest(userId, orgId, body.question(), body.idempotencyKey()));

    return ResponseEntity.ok(
        new QueryResponse(
            result.queryId(),
            body.question(),
            result.answer(),
            result.citations(),
            result.relatedDocs(),
            result.metadata()));
  }
}
