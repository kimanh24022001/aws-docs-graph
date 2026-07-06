package com.awsdocs.infrastructure;

import com.amazonaws.serverless.proxy.model.AwsProxyRequest;
import com.amazonaws.serverless.proxy.model.AwsProxyResponse;
import com.amazonaws.serverless.proxy.spring.SpringBootLambdaContainerHandler;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.awsdocs.infrastructure.config.SpringConfig;

public class LambdaHandler implements RequestHandler<AwsProxyRequest, AwsProxyResponse> {

  private static final SpringBootLambdaContainerHandler<AwsProxyRequest, AwsProxyResponse> handler;

  static {
    try {
      handler = SpringBootLambdaContainerHandler.getAwsProxyHandler(SpringConfig.class);
    } catch (Exception e) {
      throw new RuntimeException("Failed to initialize Spring handler", e);
    }
  }

  @Override
  public AwsProxyResponse handleRequest(AwsProxyRequest input, Context context) {
    return handler.proxy(input, context);
  }
}
