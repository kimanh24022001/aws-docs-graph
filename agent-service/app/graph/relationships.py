"""Rule-based relationship extraction from document titles and URLs.

Detects cross-service relationships from title patterns like:
- "DynamoDB Streams and Lambda triggers" → dynamodb -[TRIGGERS]-> lambda
- "Use Lambda with S3" → lambda -[INTEGRATES_WITH]-> s3
- "Invoke Lambda from DynamoDB" → dynamodb -[TRIGGERS]-> lambda
"""

import re

from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

router = APIRouter()

# Known AWS service name variants → canonical service id
SERVICE_ALIASES = {
    "lambda": "lambda",
    "aws lambda": "lambda",
    "s3": "s3",
    "amazon s3": "s3",
    "dynamodb": "dynamodb",
    "amazon dynamodb": "dynamodb",
    "iam": "iam",
    "aws iam": "iam",
    "iam role": "iam",
    "ec2": "ec2",
    "amazon ec2": "ec2",
    "sns": "sns",
    "amazon sns": "sns",
    "sqs": "sqs",
    "amazon sqs": "sqs",
    "cloudwatch": "cloudwatch",
    "amazon cloudwatch": "cloudwatch",
    "kinesis": "kinesis",
    "amazon kinesis": "kinesis",
    "eventbridge": "eventbridge",
    "amazon eventbridge": "eventbridge",
    "rds": "rds",
    "amazon rds": "rds",
    "eks": "eks",
    "amazon eks": "eks",
    "ecs": "ecs",
    "amazon ecs": "ecs",
    "api gateway": "apigateway",
    "amazon api gateway": "apigateway",
    "step functions": "stepfunctions",
    "aws step functions": "stepfunctions",
    "cognito": "cognito",
    "amazon cognito": "cognito",
    "cloudformation": "cloudformation",
    "aws cloudformation": "cloudformation",
    "bedrock": "bedrock",
    "amazon bedrock": "bedrock",
}

# Relationship patterns: (regex, rel_type, src_group, tgt_group)
# Group 0 = source service, Group 1 = target service
TITLE_PATTERNS = [
    # "DynamoDB Streams and Lambda triggers" / "Lambda triggers for DynamoDB"
    (r"([\w\s]+?)\s+triggers?\s+(?:for\s+)?([\w\s]+)", "TRIGGERS"),
    # "Invoke Lambda from DynamoDB" / "Invoke a Lambda function from a DynamoDB trigger"
    (r"invoke\s+(?:a\s+)?([\w\s]+?)\s+from\s+(?:a\s+)?([\w\s]+)", "TRIGGERED_BY"),
    # "Use Lambda with S3" / "Using Lambda with S3"
    (r"us(?:e|ing)\s+([\w\s]+?)\s+with\s+([\w\s]+)", "INTEGRATES_WITH"),
    # "Lambda and S3 integration" / "Integrating Lambda with DynamoDB"
    (r"integrat(?:e|ing|ion)\s+([\w\s]+?)\s+with\s+([\w\s]+)", "INTEGRATES_WITH"),
    # "DynamoDB Streams and AWS Lambda"
    (
        r"([\w\s]+?)\s+and\s+(?:aws\s+)?(lambda|s3|dynamodb|sqs|sns|kinesis|eventbridge|iam)",
        "INTEGRATES_WITH",
    ),
    # "process S3 events with Lambda"
    (r"process\s+([\w\s]+?)\s+(?:events?\s+)?with\s+([\w\s]+)", "PROCESSES"),
    # "backed by DynamoDB" / "stored in S3"
    (r"(?:backed by|stored in|store.*?in)\s+([\w\s]+)", "STORES_IN"),
    # "authenticate.*with IAM" / "using IAM for"
    (r"(?:authenticat|authoriz).*?with\s+(iam|cognito|[\w]+)", "AUTH_VIA"),
]


def extract_service(text: str) -> str | None:
    """Extract canonical service id from a text fragment."""
    t = text.strip().lower()
    # Try longest match first
    for alias in sorted(SERVICE_ALIASES.keys(), key=len, reverse=True):
        if alias in t:
            return SERVICE_ALIASES[alias]
    return None


def extract_relationships(doc_service: str, title: str) -> list[dict]:
    """Return list of {src, rel_type, tgt} from a doc title."""
    if not title or not doc_service:
        return []

    rels = []
    title_lower = title.lower()

    for pattern, rel_type in TITLE_PATTERNS:
        for m in re.finditer(pattern, title_lower, re.IGNORECASE):
            groups = m.groups()
            if len(groups) == 2:
                src = extract_service(groups[0]) or doc_service
                tgt = extract_service(groups[1])
            elif len(groups) == 1:
                # Single target — source is the doc's own service
                src = doc_service
                tgt = extract_service(groups[0])
            else:
                continue

            if tgt and src != tgt:
                rels.append({"src": src, "rel_type": rel_type, "tgt": tgt})

    return rels


@router.post("/internal/graph/extract-relationships", status_code=202)
async def extract_relationships_endpoint():
    """Extract cross-service relationships from document titles and create edges in Neo4j."""
    pool = await get_pool()

    rows = await pool.fetch(
        "SELECT id, url, title, service FROM app.documents "
        "WHERE status = 'active' AND title IS NOT NULL AND service IS NOT NULL"
    )

    relationships_found = 0
    edges_created = 0

    for row in rows:
        doc_service = row["service"]
        title = row["title"] or ""
        rels = extract_relationships(doc_service, title)
        if not rels:
            continue

        relationships_found += len(rels)

        async with neo4j_session() as s:
            for rel in rels:
                # Find any doc nodes for src and tgt service, create service-level edge
                result = await s.run(
                    """
                    MATCH (src:Document {service: $src})
                    WHERE src.placeholder IS NULL OR src.placeholder = false
                    WITH src LIMIT 1
                    MATCH (tgt:Document {service: $tgt})
                    WHERE tgt.placeholder IS NULL OR tgt.placeholder = false
                    WITH src, tgt LIMIT 1
                    MERGE (src)-[r:CROSS_SERVICE {rel_type: $rel_type}]->(tgt)
                    ON CREATE SET r.weight = 1, r.created_at = $now
                    ON MATCH SET r.weight = r.weight + 1
                    RETURN count(r) AS created
                    """,
                    src=rel["src"],
                    tgt=rel["tgt"],
                    rel_type=rel["rel_type"],
                    now=__import__("datetime")
                    .datetime.now(__import__("datetime").timezone.utc)
                    .isoformat(),
                )
                data = await result.data()
                if data:
                    edges_created += 1

    return {
        "docs_scanned": len(rows),
        "relationships_found": relationships_found,
        "edges_created": edges_created,
    }
