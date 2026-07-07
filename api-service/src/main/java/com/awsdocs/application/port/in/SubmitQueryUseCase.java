package com.awsdocs.application.port.in;

import com.awsdocs.domain.model.QueryRequest;
import com.awsdocs.domain.model.QueryResult;

public interface SubmitQueryUseCase {
  QueryResult submit(QueryRequest request);
}
