package com.awsdocs.application.port.out;

public interface UserVisitsRepository {
  void upsertVisit(String userId, String docUrl, String docTitle, String service);
}
