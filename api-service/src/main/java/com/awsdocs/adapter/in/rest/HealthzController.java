package com.awsdocs.adapter.in.rest;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthzController {

  @GetMapping("/v1/healthz")
  public Map<String, String> healthz() {
    return Map.of("status", "ok");
  }
}
