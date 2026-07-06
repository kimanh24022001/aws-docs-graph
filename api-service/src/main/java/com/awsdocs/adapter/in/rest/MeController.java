package com.awsdocs.adapter.in.rest;

import com.awsdocs.adapter.in.rest.dto.UserResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MeController {

  @GetMapping("/v1/me")
  public UserResponse me(HttpServletRequest request) {
    // Lambda Authorizer injects userId and email into request context headers
    String userId = request.getHeader("X-User-Id");
    String email = request.getHeader("X-User-Email");
    return new UserResponse(userId, email);
  }
}
