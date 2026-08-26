#!/usr/bin/env python3
"""
Validates that prisma/schema.prisma matches the CUMULATIVE effect of every
migration under prisma/migrations/, applied in order (0001, 0002, ...) --
not just the initial migration. Each migration folder's migration.sql is
scanned for CREATE TABLE and ALTER TABLE ... ADD COLUMN statements, building
up a picture of final table/column state exactly as a real `prisma migrate
deploy` run would leave the database.

This is NOT a substitute for actually running the migrations against
Postgres. It is a structural cross-check: every model in the Prisma schema
must have a matching table (created by some migration), and the scalar field
names on each must line up 1:1 with the columns that migration history
produces (relation-only fields on the Prisma side, which don't produce a
column, are excluded by design -- see bare_type logic below).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRISMA_PATH = ROOT / "prisma" / "schema.prisma"
MIGRATIONS_DIR = ROOT / "prisma" / "migrations"


def parse_prisma_model_names(text: str):
    return set(re.findall(r"^model\s+(\w+)\s*\{", text, re.MULTILINE))


def parse_prisma_enum_names(text: str):
    return set(re.findall(r"^enum\s+(\w+)\s*\{", text, re.MULTILINE))


SCALAR_PREFIXES = ("String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes")


def parse_prisma_models(text: str):
    """Return {model_name: {map_table_name, fields: set(field_name)}}"""
    model_names = parse_prisma_model_names(text)
    enum_names = parse_prisma_enum_names(text)
    models = {}
    # Match `model Name { ... }` blocks (non-greedy, DOTALL)
    for m in re.finditer(r"^model\s+(\w+)\s*\{(.*?)^\}", text, re.MULTILINE | re.DOTALL):
        name, body = m.group(1), m.group(2)
        table_map = re.search(r'@@map\("(\w+)"\)', body)
        table_name = table_map.group(1) if table_map else name
        fields = set()
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("//") or line.startswith("@@"):
                continue
            fm = re.match(r"^(\w+)\s+([\w\[\]\.\?]+)(.*)$", line)
            if not fm:
                continue
            field_name, field_type, _rest = fm.group(1), fm.group(2), fm.group(3)
            bare_type = field_type.rstrip("[]").rstrip("?")
            # Scalars (String, Int, enums, etc.) always produce a column.
            # Fields whose type is another *model* never produce a column of
            # their own name -- either they're the relation object on the FK
            # side (the real column is the separately-declared `xxxId` field)
            # or they're the back-relation / list side (no column at all).
            if bare_type in model_names and bare_type not in enum_names:
                continue
            fields.add(field_name)
        models[name] = {"table": table_name, "fields": fields}
    return models


def ordered_migration_files():
    """Migration folders sorted by their numeric prefix (0001, 0002, ...)."""
    folders = [p for p in MIGRATIONS_DIR.iterdir() if p.is_dir()]
    folders.sort(key=lambda p: p.name)
    return [p / "migration.sql" for p in folders if (p / "migration.sql").exists()]


def parse_sql_tables_cumulative(migration_paths):
    """Return {table_name: set(column_name)} after applying every migration
    in order: CREATE TABLE establishes a table, ALTER TABLE ... ADD COLUMN
    adds to it. Tables/columns are never removed by any migration so far."""
    tables = {}
    for path in migration_paths:
        text = path.read_text()

        for m in re.finditer(r'CREATE TABLE "(\w+)"\s*\((.*?)\n\);', text, re.DOTALL):
            table_name, body = m.group(1), m.group(2)
            columns = set()
            for line in body.splitlines():
                line = line.strip().rstrip(",")
                if not line:
                    continue
                cm = re.match(r'^"(\w+)"\s+', line)
                if cm:
                    columns.add(cm.group(1))
            tables[table_name] = columns

        for m in re.finditer(
            r'ALTER TABLE\s+"(\w+)"\s+ADD COLUMN\s+"(\w+)"', text
        ):
            table_name, column_name = m.group(1), m.group(2)
            if table_name in tables:
                tables[table_name].add(column_name)
            # If the table doesn't exist yet in our tracking, the ALTER
            # would fail for real too -- surface it rather than silently
            # dropping the column, so the inconsistency is visible.
            else:
                tables[table_name] = {column_name}

    return tables


def main():
    prisma_text = PRISMA_PATH.read_text()
    migration_paths = ordered_migration_files()

    models = parse_prisma_models(prisma_text)
    tables = parse_sql_tables_cumulative(migration_paths)

    errors = []

    expected_tables = {info["table"] for info in models.values()}
    missing_in_sql = expected_tables - set(tables.keys())
    extra_in_sql = set(tables.keys()) - expected_tables
    if missing_in_sql:
        errors.append(f"Tables in schema.prisma but missing from migrations: {sorted(missing_in_sql)}")
    if extra_in_sql:
        errors.append(f"Tables in migrations but not declared in schema.prisma: {sorted(extra_in_sql)}")

    for model_name, info in models.items():
        table = info["table"]
        if table not in tables:
            continue  # already reported above
        sql_columns = tables[table]
        prisma_fields = info["fields"]
        missing_cols = prisma_fields - sql_columns
        extra_cols = sql_columns - prisma_fields
        if missing_cols:
            errors.append(f"[{model_name} / {table}] fields in Prisma but no matching SQL column: {sorted(missing_cols)}")
        if extra_cols:
            errors.append(f"[{model_name} / {table}] SQL columns with no matching Prisma field: {sorted(extra_cols)}")

    print(f"Parsed {len(models)} Prisma models and {len(tables)} SQL tables across {len(migration_paths)} migration file(s).\n")

    if errors:
        print(f"FAILED — {len(errors)} inconsistency(ies) found:\n")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("PASSED — every Prisma model has a matching SQL table, and all scalar fields line up with columns across the full migration history.")
        sys.exit(0)


if __name__ == "__main__":
    main()

