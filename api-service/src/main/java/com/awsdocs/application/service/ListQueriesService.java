package com.awsdocs.application.service;

import com.awsdocs.application.port.in.ListQueriesUseCase;
import com.awsdocs.application.port.out.QueryRepository;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class ListQueriesService implements ListQueriesUseCase {

  private final QueryRepository queryRepository;

  public ListQueriesService(QueryRepository queryRepository) {
    this.queryRepository = queryRepository;
  }

  @Override
  public List<Map<String, Object>> listRecent(String userId, int limit) {
    return queryRepository.listRecent(userId, limit);
  }
}
