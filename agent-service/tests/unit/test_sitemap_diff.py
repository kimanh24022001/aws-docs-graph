from app.ingest.sitemap import diff_urls


def test_diff_identifies_new_urls():
    sitemap_urls = {"https://docs.aws.amazon.com/a", "https://docs.aws.amazon.com/b"}
    existing_hashes = {}  # url_hash -> url, empty = no existing docs
    new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)
    assert sitemap_urls == new_urls
    assert gone_urls == set()


def test_diff_identifies_gone_urls():
    import hashlib

    old_url = "https://docs.aws.amazon.com/old"
    old_hash = hashlib.sha256(old_url.encode()).hexdigest()
    sitemap_urls = {"https://docs.aws.amazon.com/new"}
    existing_hashes = {old_hash: old_url}
    new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)
    assert old_url in gone_urls
    assert old_url not in new_urls


def test_diff_existing_url_not_new():
    import hashlib

    url = "https://docs.aws.amazon.com/existing"
    url_hash = hashlib.sha256(url.encode()).hexdigest()
    sitemap_urls = {url}
    existing_hashes = {url_hash: url}
    new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)
    assert url not in new_urls
    assert url not in gone_urls
