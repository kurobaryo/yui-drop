# Yui-Drop backend

FastAPI + SQLAlchemy 2.0 (async) + Alembic + Pydantic v2 backend for Yui-Drop.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

See [`../docs/API.md`](../docs/API.md) for the REST contract and
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the layout.
