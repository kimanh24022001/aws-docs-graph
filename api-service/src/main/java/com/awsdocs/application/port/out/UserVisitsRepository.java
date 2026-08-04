package com.awsdocs.application.port.out;

import java.util.Map;

public interface UserVisitsRepository {
  void upsertVisit(String userId, String docUrl, String docTitle, String service);

  Map<String, Object> getMyLearning(String userId);
}
