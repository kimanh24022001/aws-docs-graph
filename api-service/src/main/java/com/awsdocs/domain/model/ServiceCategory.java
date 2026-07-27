package com.awsdocs.domain.model;

import java.util.Map;

/** Maps AWS service identifiers to high-level categories for the galaxy Level-0 view. */
public final class ServiceCategory {

  private ServiceCategory() {}

  private static final Map<String, String> SERVICE_TO_CATEGORY = Map.ofEntries(
      // Compute
      Map.entry("ec2", "Compute"),
      Map.entry("awsec2", "Compute"),
      Map.entry("lambda", "Compute"),
      Map.entry("ecs", "Compute"),
      Map.entry("amazonecs", "Compute"),
      Map.entry("eks", "Compute"),
      Map.entry("batch", "Compute"),
      Map.entry("elasticbeanstalk", "Compute"),
      // Storage
      Map.entry("s3", "Storage"),
      Map.entry("amazons3", "Storage"),
      Map.entry("efs", "Storage"),
      Map.entry("fsx", "Storage"),
      Map.entry("glacier", "Storage"),
      Map.entry("backup", "Storage"),
      Map.entry("storagegateway", "Storage"),
      // Security
      Map.entry("iam", "Security"),
      Map.entry("kms", "Security"),
      Map.entry("cognito", "Security"),
      Map.entry("secretsmanager", "Security"),
      Map.entry("waf", "Security"),
      Map.entry("acm", "Security"),
      Map.entry("guardduty", "Security"),
      // Database
      Map.entry("dynamodb", "Database"),
      Map.entry("amazondynamodb", "Database"),
      Map.entry("rds", "Database"),
      Map.entry("amazonrds", "Database"),
      Map.entry("elasticache", "Database"),
      Map.entry("redshift", "Database"),
      Map.entry("neptune", "Database"),
      // Networking
      Map.entry("vpc", "Networking"),
      Map.entry("route53", "Networking"),
      Map.entry("cloudfront", "Networking"),
      Map.entry("apigateway", "Networking"),
      Map.entry("elb", "Networking"),
      Map.entry("directconnect", "Networking"),
      // Analytics
      Map.entry("athena", "Analytics"),
      Map.entry("glue", "Analytics"),
      Map.entry("kinesis", "Analytics"),
      Map.entry("emr", "Analytics"),
      Map.entry("quicksight", "Analytics"),
      Map.entry("opensearch", "Analytics"),
      // AI/ML
      Map.entry("bedrock", "AI/ML"),
      Map.entry("sagemaker", "AI/ML"),
      Map.entry("comprehend", "AI/ML"),
      Map.entry("rekognition", "AI/ML"),
      Map.entry("textract", "AI/ML"),
      Map.entry("polly", "AI/ML"),
      // Integration
      Map.entry("sns", "Integration"),
      Map.entry("sqs", "Integration"),
      Map.entry("awssimplequeueservice", "Integration"),
      Map.entry("eventbridge", "Integration"),
      Map.entry("stepfunctions", "Integration"),
      Map.entry("mq", "Integration"),
      Map.entry("appflow", "Integration"),
      // DevOps
      Map.entry("cloudformation", "DevOps"),
      Map.entry("awscloudformation", "DevOps"),
      Map.entry("cloudwatch", "DevOps"),
      Map.entry("amazoncloudwatch", "DevOps"),
      Map.entry("cdk", "DevOps"),
      Map.entry("cli", "DevOps"),
      Map.entry("codebuild", "DevOps"),
      Map.entry("codepipeline", "DevOps"),
      Map.entry("codedeploy", "DevOps"),
      // SDK category (for SDK docs grouped separately)
      Map.entry("sdk", "SDK"),
      // Fallback aliases — handle data not yet migrated
      Map.entry("sdkfornet", "SDK"),
      Map.entry("awsjavasdk", "SDK"),
      Map.entry("aws-sdk-php", "SDK"),
      Map.entry("awssdkforphp", "SDK"),
      Map.entry("embedded-csdk", "SDK"),
      Map.entry("freertos", "SDK"),
      Map.entry("code-library", "SDK"));

  /** Returns the category for a service, or "Other" if unmapped. */
  public static String categoryFor(String service) {
    if (service == null) return "Other";
    return SERVICE_TO_CATEGORY.getOrDefault(service.toLowerCase(), "Other");
  }
}
