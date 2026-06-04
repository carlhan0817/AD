import httpx
import pytest
import respx

from ad_pipeline.windrun.client import WindrunClient

BASE = "https://api.windrun.io/api/v2"


@respx.mock
def test_get_json_returns_parsed_body():
    respx.get(f"{BASE}/static/heroes").mock(
        return_value=httpx.Response(200, json={"data": {"1": {"id": 1}}})
    )
    c = WindrunClient()
    out = c.get_json("/static/heroes")
    assert out["data"]["1"]["id"] == 1


@respx.mock
def test_retries_on_503_then_succeeds():
    route = respx.get(f"{BASE}/abilities")
    route.side_effect = [
        httpx.Response(503, headers={"Retry-After": "0"}),
        httpx.Response(200, json={"data": {"ok": True}}),
    ]
    c = WindrunClient(max_retries=3)
    out = c.get_json("/abilities")
    assert out["data"]["ok"] is True
    assert route.call_count == 2


@respx.mock
def test_gives_up_after_max_retries():
    respx.get(f"{BASE}/abilities").mock(
        return_value=httpx.Response(503, headers={"Retry-After": "0"})
    )
    c = WindrunClient(max_retries=2)
    with pytest.raises(httpx.HTTPStatusError):
        c.get_json("/abilities")
