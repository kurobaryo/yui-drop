"""Service layer — pure business logic, no HTTP types.

Each module exposes a small set of async functions called by the router. They
accept primitives (str, dict, ...) plus an ``AsyncSession`` and return plain
dicts (matching the schemas in ``app.schemas``).
"""
