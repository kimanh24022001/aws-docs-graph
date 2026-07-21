from app.graph.concepts import build_concept_nodes, extract_headings

SAMPLE_HTML = """
<html><body>
<div id="main-content">
  <h1>Amazon S3 Overview</h1>
  <h2>Buckets</h2>
  <h3>Bucket Naming Rules</h3>
  <h2>Objects</h2>
  <h3>Object Keys</h3>
  <p>Some content here.</p>
</div>
</body></html>
"""


def test_extract_headings_returns_all_levels():
    headings = extract_headings(SAMPLE_HTML)
    assert len(headings) == 5
    assert headings[0] == ("Amazon S3 Overview", 1)
    assert headings[1] == ("Buckets", 2)
    assert headings[2] == ("Bucket Naming Rules", 3)


def test_extract_headings_ignores_empty():
    html = '<div id="main-content"><h2></h2><h2>Real Heading</h2></div>'
    headings = extract_headings(html)
    assert len(headings) == 1
    assert headings[0] == ("Real Heading", 2)


def test_extract_headings_no_main_content_falls_back_to_body():
    html = "<html><body><h1>Title</h1></body></html>"
    headings = extract_headings(html)
    assert headings[0] == ("Title", 1)


def test_build_concept_nodes_produces_unique_ids():
    doc_id = "doc-123"
    service = "s3"
    headings = [("Buckets", 2), ("Objects", 2), ("Buckets", 2)]
    nodes = build_concept_nodes(doc_id, service, headings)
    # Duplicate headings should be deduplicated
    names = [n["name"] for n in nodes]
    assert names.count("Buckets") == 1
    assert len(nodes) == 2
    # Each node has required fields
    for node in nodes:
        assert "id" in node
        assert "name" in node
        assert node["service"] == "s3"
        assert node["source_doc_id"] == "doc-123"
