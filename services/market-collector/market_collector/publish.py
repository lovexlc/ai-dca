from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any, Callable


class Publisher:
    def publish(self, latest_payload: dict[str, Any], health_payload: dict[str, Any]) -> None:
        raise NotImplementedError


class FilePublisher(Publisher):
    def __init__(self, output_dir: str) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _write_json(self, name: str, payload: dict[str, Any]) -> None:
        path = self.output_dir / name
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temp_path.replace(path)

    def publish(self, latest_payload: dict[str, Any], health_payload: dict[str, Any]) -> None:
        self._write_json("latest.json", latest_payload)
        self._write_json("health.json", health_payload)


OpenUrl = Callable[..., Any]


class ReplicatingPublisher(Publisher):
    def __init__(
        self,
        output_dir: str,
        worker_url: str,
        token_env: str,
        outbox_dir: str,
        timeout_sec: float = 15.0,
        opener: OpenUrl = urllib.request.urlopen,
    ) -> None:
        self.files = FilePublisher(output_dir)
        self.worker_url = worker_url.rstrip("/")
        self.token_env = token_env
        self.outbox_dir = Path(outbox_dir)
        self.outbox_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_sec = timeout_sec
        self.opener = opener

    def _post(self, envelope: dict[str, Any]) -> None:
        token = os.environ.get(self.token_env, "").strip()
        if not token:
            raise RuntimeError(f"missing publisher token env: {self.token_env}")
        request = urllib.request.Request(
            self.worker_url,
            data=json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "accept": "application/json",
                "content-type": "application/json",
                "x-market-collector-token": token,
                "user-agent": "curl/8.4.0",
            },
        )
        with self.opener(request, timeout=self.timeout_sec) as response:
            status = int(getattr(response, "status", 200))
            if status < 200 or status >= 300:
                raise RuntimeError(f"collector ingest HTTP {status}")
            body = response.read()
            if body:
                result = json.loads(body.decode("utf-8", "replace"))
                if result.get("ok") is False:
                    raise RuntimeError("collector ingest rejected payload")

    def _outbox_path(self, envelope: dict[str, Any]) -> Path:
        generated_at = str((envelope.get("latest") or {}).get("generated_at") or "unknown")
        safe_id = re.sub(r"[^0-9A-Za-z_.-]+", "-", generated_at).strip("-") or "unknown"
        return self.outbox_dir / f"{safe_id}.json"

    def _spool(self, envelope: dict[str, Any]) -> None:
        path = self._outbox_path(envelope)
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(envelope, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        temp_path.replace(path)

    def _flush_outbox(self) -> None:
        for path in sorted(self.outbox_dir.glob("*.json")):
            envelope = json.loads(path.read_text(encoding="utf-8"))
            self._post(envelope)
            path.unlink()

    def publish(self, latest_payload: dict[str, Any], health_payload: dict[str, Any]) -> None:
        self.files.publish(latest_payload, health_payload)
        envelope = {"latest": latest_payload, "health": health_payload}
        if latest_payload.get("datasets"):
            envelope["datasets"] = latest_payload["datasets"]
        try:
            self._flush_outbox()
            self._post(envelope)
        except Exception:
            self._spool(envelope)


def build_publisher(config: dict[str, Any]) -> Publisher:
    publisher = config.get("publisher") or {}
    backend = str(publisher.get("backend") or "file").strip().lower()
    if backend == "file":
        return FilePublisher(str(config["output_dir"]))
    if backend == "file+worker":
        worker_url = str(publisher.get("worker_url") or "").strip()
        if not worker_url:
            raise ValueError("publisher.worker_url is required for file+worker")
        return ReplicatingPublisher(
            output_dir=str(config["output_dir"]),
            worker_url=worker_url,
            token_env=str(publisher.get("token_env") or "MARKET_COLLECTOR_TOKEN"),
            outbox_dir=str(publisher.get("outbox_dir") or (Path(str(config["output_dir"])).parent / "publish-outbox")),
            timeout_sec=float(publisher.get("timeout_sec") or 15),
        )
    raise ValueError(f"unsupported publisher backend: {backend}")
