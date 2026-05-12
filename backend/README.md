# Backend — Yui-Drop

FastAPI + SQLAlchemy 2.0 (async) + Alembic. See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the high-level design.

## Local dev

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Tests: `pytest`
Lint: `ruff check . && ruff format --check .`
Type-check: `mypy app`
