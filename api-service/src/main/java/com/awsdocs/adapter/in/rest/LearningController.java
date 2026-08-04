package com.awsdocs.adapter.in.rest;

import com.awsdocs.application.port.out.UserVisitsRepository;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/graph")
public class LearningController {

  private final UserVisitsRepository userVisitsRepository;

  public LearningController(UserVisitsRepository userVisitsRepository) {
    this.userVisitsRepository = userVisitsRepository;
  }

  @GetMapping("/my-learning")
  public Map<String, Object> myLearning(
      @RequestParam(defaultValue = "00000000-0000-0000-0000-000000000001") String userId) {
    return userVisitsRepository.getMyLearning(userId);
  }
}
