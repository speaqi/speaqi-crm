#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

from import_contacts_csv import (
    SupabaseImportError,
    auth_headers,
    fetch_user_from_token,
    json_request,
    load_env_file,
    sign_in_with_password,
)


UNSTABLE_IMPORT_LEGACY_ID_PREFIX = "csv-import-"
DEFAULT_SOURCE = "dmo-final-restore"
DEFAULT_STATUS = "New"


@dataclass
class DmoRow:
    name: str
    email: str | None
    phone: str | None
    city: str | None
    region: str | None
    address: str | None
    url_enit: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore final DMO contacts from the authoritative CSV.")
    parser.add_argument("input_csv", help="Path to final DMO CSV.")
    parser.add_argument("--email", help="CRM login email for user-scoped restore.")
    parser.add_argument("--password", help="CRM login password for user-scoped restore.")
    parser.add_argument("--access-token", help="Existing Supabase access token.")
    parser.add_argument("--user-id", help="Explicit target user ID. Required with service-role auth.")
    parser.add_argument("--supabase-url", help="Supabase project URL.")
    parser.add_argument("--anon-key", help="Supabase anon key.")
    parser.add_argument("--service-role-key", help="Supabase service role key.")
    parser.add_argument("--dry-run", action="store_true", help="Print the remediation plan without changing data.")
    parser.add_argument("--report-json", help="Optional path where the restore report JSON is written.")
    parser.add_argument(
        "--contact-scope",
        choices=["crm", "holding"],
        default="crm",
        help="Scope for newly created DMO contacts (default: crm).",
    )
    parser.add_argument(
        "--default-list-name",
        help="Optional list_name to stamp on restored contacts. Defaults to the CSV filename.",
    )
    return parser.parse_args()


def normalize_text(value: Any) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def normalize_key(value: Any) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
    )


def normalize_phone(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def normalize_name(value: Any) -> str:
    return (
        normalize_key(value)
        .replace('"', "")
        .replace("'", "")
        .replace(".", " ")
        .replace(",", " ")
        .replace("-", " ")
    )


def name_tokens(value: Any) -> set[str]:
    stopwords = {"di", "del", "della", "dell", "e", "il", "la", "per", "in", "spa", "srl", "societa"}
    return {token for token in normalize_name(value).split() if len(token) > 2 and token not in stopwords}


def names_similar(*values: Any) -> bool:
    cleaned = [name_tokens(value) for value in values if normalize_text(value)]
    if len(cleaned) < 2:
      return False

    left = cleaned[0]
    for right in cleaned[1:]:
        if not left or not right:
            continue
        if left == right:
            return True
        overlap = len(left & right)
        ratio = overlap / max(min(len(left), len(right)), 1)
        if ratio >= 0.6:
            return True
    return False


def is_unstable_legacy_id(value: Any) -> bool:
    return str(value or "").startswith(UNSTABLE_IMPORT_LEGACY_ID_PREFIX)


def is_generic_import_name(value: Any) -> bool:
    normalized = normalize_name(value)
    return normalized.startswith("lead legacy") or normalized.startswith("import csv") or normalized.startswith("contatto senza nome")


def can_overwrite_exact_match(contact: dict[str, Any], row: DmoRow) -> bool:
    if names_similar(contact.get("name"), row.name) or names_similar(contact.get("company"), row.name):
        return True

    return (
        is_unstable_legacy_id(contact.get("legacy_id"))
        and not normalize_text(contact.get("company"))
        and is_generic_import_name(contact.get("name"))
    )


def default_followup_at() -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0).isoformat()


def read_dmo_rows(path: Path) -> list[DmoRow]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        rows: list[DmoRow] = []
        for row in reader:
            name = normalize_text(row.get("name"))
            if not name:
                continue
            rows.append(
                DmoRow(
                    name=name,
                    email=normalize_text(row.get("email")),
                    phone=normalize_text(row.get("telefono")),
                    city=normalize_text(row.get("citta")),
                    region=normalize_text(row.get("regione")),
                    address=normalize_text(row.get("indirizzo")),
                    url_enit=normalize_text(row.get("url_enit")),
                )
            )
    return rows


def resolve_auth(args: argparse.Namespace, base_url: str, anon_key: str, service_role_key: str | None) -> tuple[dict[str, str], str, str]:
    if service_role_key and args.user_id:
        return auth_headers(service_role_key), args.user_id, "service_role"
    if args.access_token:
        user_id = args.user_id or fetch_user_from_token(base_url, anon_key, args.access_token)
        return auth_headers(anon_key, args.access_token), user_id, "access_token"
    if args.email and args.password:
        access_token, user_id = sign_in_with_password(base_url, anon_key, args.email, args.password)
        return auth_headers(anon_key, access_token), user_id, "password"
    raise SupabaseImportError(
        "Provide either --email with --password, --access-token, or --user-id with a service role key."
    )


def fetch_contacts(base_url: str, headers: dict[str, str], user_id: str) -> list[dict[str, Any]]:
    query = (
        "select=id,legacy_id,name,email,phone,company,source,list_name,event_tag,contact_scope,status,priority,note,next_followup_at,updated_at"
        f"&user_id=eq.{quote(user_id, safe='')}"
    )
    return json_request("GET", f"{base_url}/rest/v1/contacts?{query}", headers=headers) or []


def merge_note(existing: str | None, extra_lines: list[str]) -> str | None:
    base = normalize_text(existing) or ""
    additions = "\n".join(line for line in extra_lines if line).strip()
    if not additions:
        return base or None
    if additions in base:
        return base
    return f"{base}\n\n{additions}".strip() if base else additions


def build_dmo_note(row: DmoRow) -> str | None:
    parts = [
        "Ripristino da CSV DMO finale.",
        f"Indirizzo: {row.address}." if row.address else None,
        f"Citta: {row.city}." if row.city else None,
        f"Regione: {row.region}." if row.region else None,
        f"ENIT: {row.url_enit}" if row.url_enit else None,
    ]
    return " ".join(part for part in parts if part)


def choose_name_match(row: DmoRow, contacts: list[dict[str, Any]]) -> dict[str, Any] | None:
    normalized_target = normalize_name(row.name)
    for contact in contacts:
        if normalize_name(contact.get("name")) == normalized_target:
            return contact
    return None


def plan_restore(rows: list[DmoRow], contacts: list[dict[str, Any]], default_list_name: str, contact_scope: str) -> dict[str, Any]:
    contacts_by_email = {normalize_key(contact.get("email")): contact for contact in contacts if normalize_text(contact.get("email"))}
    contacts_by_phone = {normalize_phone(contact.get("phone")): contact for contact in contacts if normalize_phone(contact.get("phone"))}
    plan: dict[str, Any] = {
        "create": [],
        "update": [],
        "clear_conflict": [],
        "manual_review": [],
    }

    for row in rows:
        email_key = normalize_key(row.email)
        phone_key = normalize_phone(row.phone)
        email_match = contacts_by_email.get(email_key) if email_key else None
        phone_match = contacts_by_phone.get(phone_key) if phone_key else None
        same_match = email_match and phone_match and email_match.get("id") == phone_match.get("id")
        exact_match = email_match if same_match or (email_match and not phone_match) else phone_match if phone_match and not email_match else None
        name_match = choose_name_match(row, contacts)

        dmo_note = build_dmo_note(row)

        if exact_match and can_overwrite_exact_match(exact_match, row):
            update_payload = {
                "id": exact_match["id"],
                "patch": {
                    "name": row.name,
                    "email": row.email,
                    "phone": row.phone,
                    "source": exact_match.get("source") or DEFAULT_SOURCE,
                    "list_name": exact_match.get("list_name") or default_list_name,
                    "company": None if is_unstable_legacy_id(exact_match.get("legacy_id")) else exact_match.get("company"),
                    "note": merge_note(exact_match.get("note"), [dmo_note]),
                },
                "reason": "exact email/phone match",
            }
            plan["update"].append(update_payload)
            continue

        if exact_match and not names_similar(exact_match.get("name"), row.name) and not names_similar(exact_match.get("company"), row.name):
            if name_match and name_match.get("id") != exact_match.get("id"):
                plan["update"].append(
                    {
                        "id": name_match["id"],
                        "patch": {
                            "email": row.email,
                            "phone": row.phone,
                            "source": name_match.get("source") or DEFAULT_SOURCE,
                            "list_name": name_match.get("list_name") or default_list_name,
                            "note": merge_note(name_match.get("note"), [dmo_note]),
                        },
                        "reason": "exact name match found, move DMO coordinates there",
                    }
                )
            else:
                plan["create"].append(
                    {
                        "row": row.__dict__,
                        "payload": {
                            "name": row.name,
                            "email": row.email,
                            "phone": row.phone,
                            "status": DEFAULT_STATUS,
                            "source": DEFAULT_SOURCE,
                            "contact_scope": contact_scope,
                            "list_name": default_list_name,
                            "note": dmo_note,
                            "next_followup_at": None if contact_scope == "holding" else default_followup_at(),
                            "next_action_at": None if contact_scope == "holding" else default_followup_at(),
                            "last_activity_summary": "Ripristino DMO finale",
                            "priority": 0,
                        },
                        "reason": "conflicting exact match, create clean DMO contact",
                    }
                )

            clear_patch: dict[str, Any] = {}
            if email_key and normalize_key(exact_match.get("email")) == email_key:
                clear_patch["email"] = None
            if phone_key and normalize_phone(exact_match.get("phone")) == phone_key:
                clear_patch["phone"] = None
            clear_patch["note"] = merge_note(
                exact_match.get("note"),
                [f"Bonifica DMO finale: rimossi email/telefono riassegnati a {row.name}."],
            )
            plan["clear_conflict"].append(
                {
                    "id": exact_match["id"],
                    "patch": clear_patch,
                    "reason": "wrong contact carrying DMO coordinates",
                    "matched_contact": {
                        "name": exact_match.get("name"),
                        "company": exact_match.get("company"),
                        "email": exact_match.get("email"),
                        "phone": exact_match.get("phone"),
                    },
                    "target_dmo": row.__dict__,
                }
            )
            continue

        if name_match:
            plan["update"].append(
                {
                    "id": name_match["id"],
                    "patch": {
                        "email": name_match.get("email") or row.email,
                        "phone": name_match.get("phone") or row.phone,
                        "source": name_match.get("source") or DEFAULT_SOURCE,
                        "list_name": name_match.get("list_name") or default_list_name,
                        "note": merge_note(name_match.get("note"), [dmo_note]),
                    },
                    "reason": "name-only match",
                }
            )
            continue

        plan["create"].append(
            {
                "row": row.__dict__,
                "payload": {
                    "name": row.name,
                    "email": row.email,
                    "phone": row.phone,
                    "status": DEFAULT_STATUS,
                    "source": DEFAULT_SOURCE,
                    "contact_scope": contact_scope,
                    "list_name": default_list_name,
                    "note": dmo_note,
                    "next_followup_at": None if contact_scope == "holding" else default_followup_at(),
                    "next_action_at": None if contact_scope == "holding" else default_followup_at(),
                    "last_activity_summary": "Ripristino DMO finale",
                    "priority": 0,
                },
                "reason": "new DMO contact",
            }
        )

    return plan


def apply_patch(base_url: str, headers: dict[str, str], patch: dict[str, Any]) -> None:
    contact_id = patch["id"]
    json_request(
        "PATCH",
        f"{base_url}/rest/v1/contacts?id=eq.{quote(contact_id, safe='')}",
        headers={**headers, "Prefer": "return=representation"},
        data=patch["patch"],
    )


def apply_create(base_url: str, headers: dict[str, str], user_id: str, item: dict[str, Any]) -> None:
    payload = dict(item["payload"])
    payload["user_id"] = user_id
    json_request(
        "POST",
        f"{base_url}/rest/v1/contacts",
        headers={**headers, "Prefer": "return=representation"},
        data=payload,
    )


def main() -> int:
    load_env_file(Path(".env.local"))
    args = parse_args()
    input_csv = Path(args.input_csv).expanduser().resolve()
    if not input_csv.exists():
        raise SystemExit(f"Input CSV not found: {input_csv}")

    base_url = (args.supabase_url or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    anon_key = args.anon_key or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    service_role_key = args.service_role_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not anon_key:
        raise SystemExit("Supabase URL and anon key are required. Check .env.local or pass flags.")

    headers, user_id, auth_mode = resolve_auth(args, base_url, anon_key, service_role_key)
    rows = read_dmo_rows(input_csv)
    contacts = fetch_contacts(base_url, headers, user_id)
    default_list_name = normalize_text(args.default_list_name) or input_csv.stem
    plan = plan_restore(rows, contacts, default_list_name, args.contact_scope)

    report = {
        "input_csv": str(input_csv),
        "auth_mode": auth_mode,
        "target_user": user_id,
        "rows": len(rows),
        "create_count": len(plan["create"]),
        "update_count": len(plan["update"]),
        "clear_conflict_count": len(plan["clear_conflict"]),
        "manual_review_count": len(plan["manual_review"]),
        "plan": plan,
    }

    print(json.dumps({k: v for k, v in report.items() if k != "plan"}, ensure_ascii=False, indent=2))

    if args.report_json:
        Path(args.report_json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Report written to {args.report_json}")

    if args.dry_run:
        print("Dry run only.")
        return 0

    for patch in plan["update"]:
        apply_patch(base_url, headers, patch)
    for patch in plan["clear_conflict"]:
        apply_patch(base_url, headers, patch)
    for item in plan["create"]:
        apply_create(base_url, headers, user_id, item)

    print("DMO restore complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
