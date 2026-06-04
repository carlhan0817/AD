"""Windrun v2 REST 客户端。处理 503 + Retry-After(计划书 §六)。"""
import time

import httpx

BASE_URL = "https://api.windrun.io/api/v2"


class WindrunClient:
    def __init__(self, base_url: str = BASE_URL, max_retries: int = 4,
                 timeout: float = 30.0, sleep=time.sleep):
        self._client = httpx.Client(base_url=base_url, timeout=timeout,
                                    headers={"Accept": "application/json"})
        self._max_retries = max_retries
        self._sleep = sleep

    def get_json(self, path: str) -> dict:
        last: httpx.Response | None = None
        for _attempt in range(self._max_retries):
            resp = self._client.get(path)
            if resp.status_code == 503:
                last = resp
                retry_after = float(resp.headers.get("Retry-After", "1"))
                self._sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp.json()
        assert last is not None
        last.raise_for_status()  # 抛出最终 503

    def close(self) -> None:
        self._client.close()
