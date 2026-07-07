package com.awsdocs.domain.exception;

public class CostCapExceededException extends RuntimeException {
  public CostCapExceededException() {
    super("Daily LLM cost cap exceeded");
  }
}
