from app.ingest.page import parse_page

AWS_SAMPLE_HTML = """
<html>
<head><title>Using IAM roles - AWS Identity and Access Management</title></head>
<body>
  <div id="main-content">
    <h1>Using IAM roles</h1>
    <p>You can use IAM roles to delegate access. See also
      <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create.html">
        Creating roles</a>
      and <a href="https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html">STS</a>.
      External link: <a href="https://example.com/external">external</a>.
    </p>
  </div>
  <div rel="prev"><a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html">Previous</a></div>
  <div rel="next"><a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_manage.html">Next</a></div>
</body>
</html>
"""


def test_parse_extracts_title():
    result = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    assert result.title == "Using IAM roles"


def test_parse_extracts_service_from_url():
    result = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    assert result.service == "iam"


def test_parse_extracts_guide_from_url():
    result = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    assert result.guide == "UserGuide"


def test_parse_extracts_aws_links_only():
    result = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    assert "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create.html" in result.links
    assert "https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html" in result.links
    assert "https://example.com/external" not in result.links


def test_parse_extracts_prev_next():
    result = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    assert result.prev_url == "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html"
    assert (
        result.next_url == "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_manage.html"
    )


def test_parse_produces_stable_hash():
    result1 = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    result2 = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    assert result1.hash == result2.hash


def test_parse_hash_changes_on_title_change():
    html_changed = AWS_SAMPLE_HTML.replace("Using IAM roles", "Using IAM roles UPDATED")
    result1 = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML
    )
    result2 = parse_page(
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", html_changed
    )
    assert result1.hash != result2.hash
