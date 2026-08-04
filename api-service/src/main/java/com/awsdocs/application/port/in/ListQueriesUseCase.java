package com.awsdocs.application.port.in;

import java.util.List;
import java.util.Map;

public interface ListQueriesUseCase {
  List<Map<String, Object>> listRecent(String userId, int limit);
}
