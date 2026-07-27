// Service → category mapping (mirrors api-service ServiceCategory.java)
const SERVICE_TO_CATEGORY: Record<string, string> = {
  // Compute
  ec2: "Compute",
  awsec2: "Compute",
  lambda: "Compute",
  ecs: "Compute",
  amazonecs: "Compute",
  eks: "Compute",
  batch: "Compute",
  elasticbeanstalk: "Compute",
  // Storage
  s3: "Storage",
  amazons3: "Storage",
  efs: "Storage",
  fsx: "Storage",
  glacier: "Storage",
  backup: "Storage",
  storagegateway: "Storage",
  // Security
  iam: "Security",
  kms: "Security",
  cognito: "Security",
  secretsmanager: "Security",
  waf: "Security",
  acm: "Security",
  guardduty: "Security",
  // Database
  dynamodb: "Database",
  amazondynamodb: "Database",
  rds: "Database",
  amazonrds: "Database",
  elasticache: "Database",
  redshift: "Database",
  neptune: "Database",
  // Networking
  vpc: "Networking",
  route53: "Networking",
  cloudfront: "Networking",
  apigateway: "Networking",
  elb: "Networking",
  directconnect: "Networking",
  // Analytics
  athena: "Analytics",
  glue: "Analytics",
  kinesis: "Analytics",
  emr: "Analytics",
  quicksight: "Analytics",
  opensearch: "Analytics",
  // AI/ML
  bedrock: "AI/ML",
  sagemaker: "AI/ML",
  comprehend: "AI/ML",
  rekognition: "AI/ML",
  textract: "AI/ML",
  polly: "AI/ML",
  // Integration
  sns: "Integration",
  sqs: "Integration",
  awssimplequeueservice: "Integration",
  eventbridge: "Integration",
  stepfunctions: "Integration",
  mq: "Integration",
  appflow: "Integration",
  // DevOps
  cloudformation: "DevOps",
  awscloudformation: "DevOps",
  cloudwatch: "DevOps",
  amazoncloudwatch: "DevOps",
  cdk: "DevOps",
  cli: "DevOps",
  codebuild: "DevOps",
  codepipeline: "DevOps",
  codedeploy: "DevOps",
  // SDK
  sdk: "SDK",
  sdkfornet: "SDK",
  awsjavasdk: "SDK",
  "aws-sdk-php": "SDK",
  awssdkforphp: "SDK",
  "embedded-csdk": "SDK",
  freertos: "SDK",
  "code-library": "SDK",
  appstudio: "SDK",
};

export function categoryFor(service: string | null): string {
  if (!service) return "Other";
  return SERVICE_TO_CATEGORY[service.toLowerCase()] ?? "Other";
}

const CATEGORY_COLORS: Record<string, string> = {
  Compute: "#ff9900",
  Storage: "#4285f4",
  Security: "#dd344c",
  Database: "#3b48cc",
  Networking: "#8b5cf6",
  Analytics: "#e7157b",
  "AI/ML": "#00bcd4",
  Integration: "#34a853",
  DevOps: "#607d8b",
  SDK: "#78909c",
  Other: "#999999",
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#999999";
}
