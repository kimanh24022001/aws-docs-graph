from app.graph.standardize import CANONICAL_MAP


def test_awsec2_in_map():
    assert CANONICAL_MAP["awsec2"] == "ec2"


def test_sdkfornet_in_map():
    assert CANONICAL_MAP["sdkfornet"] == "sdk"


def test_awsjavasdk_in_map():
    assert CANONICAL_MAP["awsjavasdk"] == "sdk"


def test_canonical_values_are_lowercase():
    for old, new in CANONICAL_MAP.items():
        assert new == new.lower(), f"{old} → {new} is not lowercase"


def test_no_self_mapping():
    # No entry should map a name to itself (that would be a no-op)
    for old, new in CANONICAL_MAP.items():
        assert old != new, f"{old} maps to itself"
