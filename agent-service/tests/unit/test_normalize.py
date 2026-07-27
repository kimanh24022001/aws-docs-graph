from app.ingest.page import _normalize_service


def test_awsec2_normalizes_to_ec2():
    assert _normalize_service("awsec2") == "ec2"


def test_sdkfornet_normalizes_to_sdk():
    assert _normalize_service("sdkfornet") == "sdk"


def test_awsjavasdk_normalizes_to_sdk():
    assert _normalize_service("awsjavasdk") == "sdk"


def test_aws_sdk_php_normalizes_to_sdk():
    assert _normalize_service("aws-sdk-php") == "sdk"


def test_awssdkforphp_normalizes_to_sdk():
    assert _normalize_service("awssdkforphp") == "sdk"


def test_embedded_csdk_normalizes_to_sdk():
    assert _normalize_service("embedded-csdk") == "sdk"


def test_freertos_normalizes_to_sdk():
    assert _normalize_service("freertos") == "sdk"


def test_code_library_normalizes_to_sdk():
    assert _normalize_service("code-library") == "sdk"


def test_existing_s3_unchanged():
    # Regression: existing normalizations must still work
    assert _normalize_service("amazons3") == "s3"


def test_unknown_passthrough():
    assert _normalize_service("someservice") == "someservice"
