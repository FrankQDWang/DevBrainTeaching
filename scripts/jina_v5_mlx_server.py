#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


MODEL_ID = os.environ.get("JINA_V5_MODEL_ID", "jinaai/jina-embeddings-v5-text-small-mlx")
MODEL_DIR = Path(
    os.environ.get("JINA_V5_MODEL_DIR", ".devbrain-teaching/models/jina-v5-text-small-mlx")
).resolve()
MODEL_NAME = os.environ.get("JINA_V5_EMBEDDING_MODEL", "jina-embeddings-v5-text-small")
DIMENSIONS = int(os.environ.get("JINA_V5_EMBEDDING_DIMENSIONS", "1024"))
HOST = os.environ.get("JINA_V5_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("JINA_V5_PROXY_PORT", "8797"))
TASK = os.environ.get("JINA_V5_TASK", "retrieval")
DOCUMENT_TASK_TYPE = os.environ.get("JINA_V5_DOCUMENT_TASK_TYPE", "retrieval.passage")
QUERY_TASK_TYPE = os.environ.get("JINA_V5_QUERY_TASK_TYPE", "retrieval.query")

_MODEL: Any = None


def dependency_error(exc: ModuleNotFoundError) -> RuntimeError:
    package = exc.name or str(exc)
    return RuntimeError(
        f"Missing Python dependency '{package}'. Install the Jina v5 MLX server dependencies "
        "before using /health?load=true or /v1/embeddings."
    )


def ensure_model() -> Any:
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    try:
        from huggingface_hub import snapshot_download
    except ModuleNotFoundError as exc:
        raise dependency_error(exc) from exc

    if not MODEL_DIR.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        snapshot_download(MODEL_ID, local_dir=str(MODEL_DIR))

    sys.path.insert(0, str(MODEL_DIR))
    try:
        from utils import load_model
    except ModuleNotFoundError as exc:
        raise dependency_error(exc) from exc

    _MODEL = load_model(str(MODEL_DIR))
    _MODEL.switch_task(TASK)
    return _MODEL


def normalize_input(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                out.append(item["text"])
            else:
                raise ValueError("Each embedding input must be a string or an object with a text field.")
        return out
    raise ValueError("Embedding input must be a string or array.")


def normalize_model_name(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return MODEL_NAME
    if ":" in value:
        return value.split(":", 1)[1]
    return value


def task_type_for_request(body: dict[str, Any]) -> str:
    raw = body.get("task_type")
    if isinstance(raw, str) and raw:
        return raw

    raw_prompt = body.get("prompt_name")
    if raw_prompt == "query":
        return QUERY_TASK_TYPE

    return DOCUMENT_TASK_TYPE


def embedding_rows(raw_embeddings: Any, input_count: int) -> list[Any]:
    if hasattr(raw_embeddings, "tolist"):
        raw_embeddings = raw_embeddings.tolist()
    elif not isinstance(raw_embeddings, list):
        raw_embeddings = list(raw_embeddings)

    if input_count == 1 and raw_embeddings and all(isinstance(value, (int, float)) for value in raw_embeddings):
        return [raw_embeddings]

    return raw_embeddings


def json_embedding_values(raw_embedding: Any) -> list[float]:
    if hasattr(raw_embedding, "tolist"):
        raw_embedding = raw_embedding.tolist()
    elif not isinstance(raw_embedding, list):
        raw_embedding = list(raw_embedding)

    return [float(value) for value in raw_embedding]


def error_payload(message: str) -> dict[str, Any]:
    return {"error": {"message": message, "type": "jina_v5_mlx_error"}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in ("/health", "/v1/health"):
            self.send_json(404, {"error": "Not found"})
            return

        query = parse_qs(parsed.query)
        loaded = _MODEL is not None
        if query.get("load") == ["true"]:
            try:
                ensure_model()
                loaded = True
            except Exception as exc:
                self.send_json(
                    503,
                    {
                        "ok": False,
                        "provider": "jina-v5-mlx",
                        "model": MODEL_NAME,
                        "model_id": MODEL_ID,
                        "dimensions": DIMENSIONS,
                        "model_dir": str(MODEL_DIR),
                        "loaded": False,
                        "error": str(exc),
                    },
                )
                return

        self.send_json(
            200,
            {
                "ok": True,
                "provider": "jina-v5-mlx",
                "model": MODEL_NAME,
                "model_id": MODEL_ID,
                "dimensions": DIMENSIONS,
                "model_dir": str(MODEL_DIR),
                "loaded": loaded,
            },
        )

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/v1/embeddings":
            self.send_json(404, {"error": "Not found. Use POST /v1/embeddings."})
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            texts = normalize_input(body.get("input"))
            model_name = normalize_model_name(body.get("model"))
            if model_name != MODEL_NAME:
                raise ValueError(f"Unsupported model {model_name}; expected {MODEL_NAME}.")

            model = ensure_model()
            raw_embeddings = model.encode(texts, task_type=task_type_for_request(body))
            rows = embedding_rows(raw_embeddings, len(texts))

            data = []
            for index, raw_embedding in enumerate(rows):
                values = json_embedding_values(raw_embedding)
                if len(values) != DIMENSIONS:
                    raise ValueError(f"Embedding dimension mismatch: got {len(values)}, expected {DIMENSIONS}.")
                data.append({"object": "embedding", "index": index, "embedding": values})

            self.send_json(
                200,
                {
                    "object": "list",
                    "data": data,
                    "model": MODEL_NAME,
                    "usage": {"prompt_tokens": 0, "total_tokens": 0},
                },
            )
        except ModuleNotFoundError as exc:
            self.send_json(503, error_payload(str(dependency_error(exc))))
        except RuntimeError as exc:
            self.send_json(503, error_payload(str(exc)))
        except Exception as exc:
            self.send_json(400, error_payload(str(exc)))


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Jina v5 MLX embedding server listening on http://{HOST}:{PORT}/v1", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
