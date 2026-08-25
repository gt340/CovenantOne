#!/usr/bin/env python3
"""
Validates that prisma/schema.prisma and prisma/migrations/0001_init_core_schema/migration.sql
describe the same set of tables and the same field/column names per table.

This is NOT a substitute for actually running the migration against Postgres
(see PHASE1_REPORT.md for why that wasn't possible in this sandbox). It is a
structural cross-check: every model in the Prisma schema must have a matching
CREATE TABLE in the SQL, and the scalar field names on each must line up
1:1 (relation-only fields on the Prisma side, which don't produce a column,
are excluded by design -- see RELATION_ONLY_FIELDS logic below).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRISMA_PATH = ROOT / "prisma" / "schema.prisma"
SQL_PATH = ROOT / "prisma" / "migrations" / "0001_init_core_schema" / "migration.sql"


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


def parse_sql_tables(text: str):
    """Return {table_name: set(column_name)}"""
    tables = {}
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
    return tables


def main():
    prisma_text = PRISMA_PATH.read_text()
    sql_text = SQL_PATH.read_text()

    models = parse_prisma_models(prisma_text)
    tables = parse_sql_tables(sql_text)

    errors = []

    expected_tables = {info["table"] for info in models.values()}
    missing_in_sql = expected_tables - set(tables.keys())
    extra_in_sql = set(tables.keys()) - expected_tables
    if missing_in_sql:
        errors.append(f"Tables in schema.prisma but missing from migration.sql: {sorted(missing_in_sql)}")
    if extra_in_sql:
        errors.append(f"Tables in migration.sql but not declared in schema.prisma: {sorted(extra_in_sql)}")

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

    print(f"Parsed {len(models)} Prisma models and {len(tables)} SQL tables.\n")

    if errors:
        print(f"FAILED — {len(errors)} inconsistency(ies) found:\n")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("PASSED — every Prisma model has a matching SQL table, and all scalar fields line up with columns.")
        sys.exit(0)


if __name__ == "__main__":
    main()
