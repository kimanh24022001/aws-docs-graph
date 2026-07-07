package com.awsdocs.application.port.out;

import com.awsdocs.domain.model.QueryResult;
import java.util.UUID;

public interface AgentServicePort {
  QueryResult runAgent(UUID queryId, String userId, String orgId, String question);
}
