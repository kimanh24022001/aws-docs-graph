package com.awsdocs.adapter.in.rest;

import com.awsdocs.adapter.in.rest.dto.QueryResponse;
import com.awsdocs.adapter.in.rest.dto.SubmitQueryRequest;
import com.awsdocs.application.port.in.ListQueriesUseCase;
import com.awsdocs.application.port.in.SubmitQueryUseCase;
import com.awsdocs.domain.model.QueryRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/queries")
public class QueryController {

  private final SubmitQueryUseCase submitQueryUseCase;
  private final ListQueriesUseCase listQueriesUseCase;

  public QueryController(SubmitQueryUseCase submitQueryUseCase, ListQueriesUseCase listQueriesUseCase) {
    this.submitQueryUseCase = submitQueryUseCase;
    this.listQueriesUseCase = listQueriesUseCase;
  }

  @GetMapping
  public Map<String, Object> list(HttpServletRequest request) {
    var queries = listQueriesUseCase.listRecent(userId(request), 50);
    var result = new java.util.HashMap<String, Object>();
    result.put("queries", queries);
    result.put("next_cursor", null);
    return result;
  }

  @PostMapping
  public ResponseEntity<QueryResponse> submit(
      @Valid @RequestBody SubmitQueryRequest body, HttpServletRequest request) {
    var result = submitQueryUseCase.submit(
        new QueryRequest(userId(request), orgId(request), body.question(), body.idempotencyKey()));
    return ResponseEntity.ok(new QueryResponse(
        result.queryId(), body.question(), result.answer(),
        result.citations(), result.relatedDocs(), result.metadata()));
  }

  private String userId(HttpServletRequest request) {
    var v = request.getHeader("X-User-Id");
    return (v != null && !v.isBlank()) ? v : "00000000-0000-0000-0000-000000000001";
  }

  private String orgId(HttpServletRequest request) {
    var v = request.getHeader("X-Org-Id");
    return (v != null && !v.isBlank()) ? v : "00000000-0000-0000-0000-000000000001";
  }
}
