#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo


DEFAULT_TIMEZONE = "Europe/Rome"
AUTO_MATCH_THRESHOLD = 0.94
REVIEW_MATCH_THRESHOLD = 0.88
IMPORT_HEADERS = [
    "legacy_id",
    "name",
    "email",
    "phone",
    "status",
    "source",
    "priority",
    "responsible",
    "value",
    "note",
    "next_followup_at",
]
MATCH_HEADERS = [
    "row_number",
    "legacy_id",
    "legacy_name",
    "responsible",
    "existing_phone",
    "matched_name",
    "matched_alias",
    "matched_alias_type",
    "matched_on",
    "match_score",
    "contact_phone",
    "contact_email",
    "auto_selected",
]
INVALID_LEGACY_IDS = {"#REF!", "#N/A", "N/A", "NULL", "null", "NaN", "nan"}


@dataclass
class ContactEntry:
    label: str
    phone: str
    email: str
    aliases: list[tuple[str, str]]


@dataclass
class MatchResult:
    score: float
    query: str
    query_type: str
    alias: str
    alias_type: str
    contact: ContactEntry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze and normalize a legacy SPEAQI CSV, optionally enriching it with a contacts export."
    )
    parser.add_argument("legacy_csv", help="Path to the messy/legacy CSV to analyze.")
    parser.add_argument(
        "--contacts-csv",
        help="Optional contacts export CSV used only for local name/phone/email matching.",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory where report and generated CSV files will be written. Defaults to /tmp.",
    )
    parser.add_argument(
        "--timezone",
        default=DEFAULT_TIMEZONE,
        help=f"Timezone used to convert follow-up dates (default: {DEFAULT_TIMEZONE}).",
    )
    parser.add_argument(
        "--auto-match-threshold",
        type=float,
        default=AUTO_MATCH_THRESHOLD,
        help=f"Minimum score used to auto-fill phone/email from the contacts file (default: {AUTO_MATCH_THRESHOLD}).",
    )
    parser.add_argument(
        "--review-threshold",
        type=float,
        default=REVIEW_MATCH_THRESHOLD,
        help=f"Minimum score included in the review CSV (default: {REVIEW_MATCH_THRESHOLD}).",
    )
    parser.add_argument(
        "--default-followup-days",
        type=int,
        default=3,
        help="Days to add for open rows without a legacy due date (default: 3).",
    )
    return parser.parse_args()


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value.strip().lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def normalize_phone(value: str | None) -> str:
    if not value:
        return ""
    raw = value.strip()
    keep_plus = raw.startswith("+")
    digits = re.sub(r"\D+", "", raw)
    if not digits:
        return ""
    return f"+{digits}" if keep_plus else digits


def parse_numeric_value(value: str | None) -> str:
    if not value or not value.strip():
        return ""
    compact = value.strip().replace(".", "").replace(" ", "")
    compact = compact.replace(",", ".")
    match = re.search(r"-?\d+(?:\.\d+)?", compact)
    if not match:
        return ""
    number = float(match.group(0))
    return str(int(number)) if number.is_integer() else f"{number:.2f}"


def parse_followup_date(value: str | None, timezone_name: str) -> str:
    if not value or not value.strip():
        return ""
    raw = value.strip()
    parsed = None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            parsed = datetime.strptime(raw, pattern)
            break
        except ValueError:
            continue
    if not parsed:
        return ""
    timezone = ZoneInfo(timezone_name)
    return parsed.replace(hour=9, minute=0, second=0, microsecond=0, tzinfo=timezone).isoformat()


def default_followup_date(days: int, timezone_name: str) -> str:
    timezone = ZoneInfo(timezone_name)
    now = datetime.now(timezone)
    followup = (now + timedelta(days=days)).replace(hour=9, minute=0, second=0, microsecond=0)
    return followup.isoformat()


def map_legacy_status(value: str | None) -> str:
    normalized = normalize_text(value)
    if normalized == "da fare":
        return "New"
    if normalized in {"da richiamare", "da richamare", "da richamare", "da richiamre"}:
        return "Contacted"
    if normalized == "in attesa":
        return "Interested"
    if normalized in {"in corso", "revisione"}:
        return "Call booked"
    if normalized in {"completato", "perso", "non interessato"}:
        return "Closed"
    return "New"


def map_legacy_priority(*values: str | None) -> int:
    for value in values:
        normalized = normalize_text(value)
        if normalized == "alta":
            return 3
        if normalized == "media":
            return 2
        if normalized == "bassa":
            return 1
    return 0


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = []
        for row in reader:
            cleaned = {}
            for key, value in row.items():
                cleaned[key or ""] = value.strip() if isinstance(value, str) else ""
            rows.append(cleaned)
    return fieldnames, rows


def contact_aliases(row: dict[str, str]) -> list[tuple[str, str]]:
    aliases: list[tuple[str, str]] = []
    ordered_sources = [
        ("name", " ".join(part for part in [row.get("First Name", ""), row.get("Last Name", "")] if part.strip())),
        ("display_name", row.get("Display Name", "")),
        ("organization", row.get("Organization", "")),
    ]
    seen = set()
    for alias_type, alias in ordered_sources:
        normalized = normalize_text(alias)
        if normalized and normalized not in seen:
            aliases.append((normalized, alias_type))
            seen.add(normalized)
    return aliases


def load_contacts(path: Path) -> list[ContactEntry]:
    _, rows = read_csv(path)
    contacts: list[ContactEntry] = []
    for row in rows:
        aliases = contact_aliases(row)
        if not aliases:
            continue
        phone = (
            normalize_phone(row.get("Mobile Phone"))
            or normalize_phone(row.get("Business Phone"))
            or normalize_phone(row.get("Home Phone"))
        )
        email = (
            row.get("E-mail Address", "")
            or row.get("E-mail 2 Address", "")
            or row.get("E-mail 3 Address", "")
        ).strip()
        label = (
            " ".join(part for part in [row.get("First Name", ""), row.get("Last Name", "")] if part.strip())
            or row.get("Display Name", "").strip()
            or row.get("Organization", "").strip()
        )
        contacts.append(ContactEntry(label=label, phone=phone, email=email, aliases=aliases))
    return contacts


def score_alias(query: str, alias: str, query_type: str, alias_type: str) -> float:
    if not query or not alias:
        return 0.0
    query_tokens = query.split()
    alias_tokens = alias.split()
    query_token_set = set(query_tokens)
    alias_token_set = set(alias_tokens)
    query_unique_count = len(query_token_set)
    alias_unique_count = len(alias_token_set)

    if query == alias:
        score = 1.0
    elif query_token_set and alias_token_set and (
        query_token_set.issubset(alias_token_set) or alias_token_set.issubset(query_token_set)
    ):
        shortest = min(len("".join(sorted(query_token_set))), len("".join(sorted(alias_token_set))))
        if shortest < 5:
            score = 0.86
        elif query_unique_count == 1 and alias_unique_count > 1:
            score = 0.91 if alias_type in {"name", "display_name"} else 0.87
        elif alias_unique_count == 1 and query_unique_count > 1:
            score = 0.89 if alias_type in {"name", "display_name"} else 0.84
        else:
            score = 0.96
    else:
        token_overlap = len(query_token_set & alias_token_set) / max(len(query_token_set), len(alias_token_set), 1)
        sequence_ratio = SequenceMatcher(None, query, alias).ratio()
        score = sequence_ratio * 0.75 + token_overlap * 0.25

        if query_unique_count == 1 and len(query_tokens[0]) < 6 and score < 0.98:
            score -= 0.06

    if query_type == "responsible" and alias_type == "name":
        score += 0.03
    if query_type == "activity" and alias_type == "organization" and alias_unique_count > 1:
        score += 0.02
    return min(score, 1.0)


def best_match(activity: str, responsible: str, contacts: Iterable[ContactEntry]) -> MatchResult | None:
    queries = []
    if responsible.strip():
        queries.append(("responsible", normalize_text(responsible)))
    if activity.strip():
        queries.append(("activity", normalize_text(activity)))

    best: MatchResult | None = None
    for query_type, query in queries:
        if len(query) < 2:
            continue
        for contact in contacts:
            for alias, alias_type in contact.aliases:
                score = score_alias(query, alias, query_type, alias_type)
                if not best or score > best.score:
                    best = MatchResult(
                        score=score,
                        query=query,
                        query_type=query_type,
                        alias=alias,
                        alias_type=alias_type,
                        contact=contact,
                    )
    return best


def nonempty_count(rows: list[dict[str, str]], key: str) -> int:
    return sum(1 for row in rows if row.get(key, "").strip())


def build_note(row: dict[str, str]) -> str:
    parts = []
    if row.get("Descrizione", "").strip():
        parts.append(row["Descrizione"].strip())
    if row.get("Regione", "").strip():
        parts.append(f"Regione: {row['Regione'].strip()}")
    if row.get("", "").strip():
        parts.append(f"Extra legacy: {row[''].strip()}")
    return "\n".join(parts)


def make_output_dir(legacy_csv: Path, output_dir: str | None) -> Path:
    if output_dir:
        path = Path(output_dir).expanduser().resolve()
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_name = re.sub(r"[^a-zA-Z0-9]+", "-", legacy_csv.stem).strip("-").lower() or "legacy"
        path = Path("/tmp") / f"speaqi-analysis-{safe_name}-{timestamp}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def make_unique_legacy_id(raw_value: str | None, index: int, seen: set[str]) -> str:
    candidate = (raw_value or "").strip()
    if not candidate or candidate in INVALID_LEGACY_IDS:
        candidate = f"legacy-row-{index:04d}"

    if candidate not in seen:
        seen.add(candidate)
        return candidate

    attempt = 2
    unique_candidate = f"{candidate}-{attempt}"
    while unique_candidate in seen:
        attempt += 1
        unique_candidate = f"{candidate}-{attempt}"
    seen.add(unique_candidate)
    return unique_candidate


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def write_report(
    path: Path,
    legacy_csv: Path,
    headers: list[str],
    rows: list[dict[str, str]],
    import_rows: list[dict[str, str]],
    review_rows: list[dict[str, str]],
    auto_selected_count: int,
    timezone_name: str,
    followup_from_legacy_count: int,
    followup_defaulted_count: int,
) -> None:
    status_counter = Counter(row["status"] for row in import_rows)
    priority_counter = Counter(row["priority"] for row in import_rows)
    lines = [
        "# Analisi CSV legacy",
        "",
        f"- File analizzato: `{legacy_csv}`",
        f"- Righe lette: `{len(rows)}`",
        f"- Fuso orario follow-up: `{timezone_name}`",
        "",
        "## Qualita dati",
        "",
        f"- Colonne originali: `{', '.join(repr(header) for header in headers)}`",
        f"- Header vuoti: `{sum(1 for header in headers if not (header or '').strip())}`",
        f"- Righe con `Attività`: `{nonempty_count(rows, 'Attività')}`",
        f"- Righe con `Responsabile`: `{nonempty_count(rows, 'Responsabile')}`",
        f"- Righe con `Numero di telefono`: `{nonempty_count(rows, 'Numero di telefono')}`",
        f"- Righe con `Descrizione`: `{nonempty_count(rows, 'Descrizione')}`",
        f"- Righe con `Stato`: `{nonempty_count(rows, 'Stato')}`",
        f"- Righe con `Scadenza`: `{nonempty_count(rows, 'Scadenza')}`",
        "",
        "## Arricchimento",
        "",
        f"- Match forti/review generati: `{len(review_rows)}`",
        f"- Match usati per auto-compilare telefono/email: `{auto_selected_count}`",
        f"- Telefono finale disponibile: `{sum(1 for row in import_rows if row['phone'])}`",
        f"- Email finale disponibile: `{sum(1 for row in import_rows if row['email'])}`",
        f"- Follow-up derivati da `Scadenza`: `{followup_from_legacy_count}`",
        f"- Follow-up di default sui contatti aperti: `{followup_defaulted_count}`",
        "",
        "## Mappatura verso CRM",
        "",
        "- `Attività` -> `name`",
        "- `Responsabile` -> `responsible`",
        "- `Numero di telefono` -> `phone`",
        "- `Stato` -> `status` (`New`, `Contacted`, `Interested`, `Call booked`, `Closed`)",
        "- `Priorità` / `Piorità` -> `priority` (0-3)",
        "- `PREZZO` -> `value`",
        "- `Descrizione` + `Regione` + colonna extra -> `note`",
        "- `Scadenza` -> `next_followup_at` alle 09:00 locali",
        "",
        "## Distribuzione stati",
        "",
    ]
    for status, count in sorted(status_counter.items()):
        lines.append(f"- `{status}`: `{count}`")
    lines.extend(["", "## Distribuzione priorita", ""])
    for priority, count in sorted(priority_counter.items(), key=lambda item: int(item[0] or 0)):
        lines.append(f"- `{priority}`: `{count}`")
    lines.extend(
        [
            "",
            "## Output generati",
            "",
            "- `contacts_import.csv`: CSV pulito pronto da importare/mappare nel CRM",
            "- `matches_review.csv`: dettaglio dei match trovati contro la rubrica",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    legacy_csv = Path(args.legacy_csv).expanduser().resolve()
    contacts_csv = Path(args.contacts_csv).expanduser().resolve() if args.contacts_csv else None
    output_dir = make_output_dir(legacy_csv, args.output_dir)

    headers, rows = read_csv(legacy_csv)
    contacts = load_contacts(contacts_csv) if contacts_csv else []

    import_rows: list[dict[str, str]] = []
    review_rows: list[dict[str, str]] = []
    auto_selected_count = 0
    followup_from_legacy_count = 0
    followup_defaulted_count = 0
    seen_legacy_ids: set[str] = set()

    for index, row in enumerate(rows, start=1):
        legacy_id = make_unique_legacy_id(row.get("ID"), index, seen_legacy_ids)
        activity = row.get("Attività", "").strip()
        responsible = row.get("Responsabile", "").strip()
        existing_phone = normalize_phone(row.get("Numero di telefono"))
        match = best_match(activity, responsible, contacts) if contacts else None
        auto_selected = bool(match and match.score >= args.auto_match_threshold)

        matched_phone = match.contact.phone if auto_selected and match else ""
        matched_email = match.contact.email if auto_selected and match else ""
        phone = existing_phone or matched_phone
        email = matched_email
        status = map_legacy_status(row.get("Stato"))
        priority = str(map_legacy_priority(row.get("Priorità"), row.get("Piorità")))
        value = parse_numeric_value(row.get("PREZZO"))
        next_followup_at = parse_followup_date(row.get("Scadenza"), args.timezone)
        if next_followup_at:
            followup_from_legacy_count += 1
        elif status != "Closed":
            next_followup_at = default_followup_date(args.default_followup_days, args.timezone)
            followup_defaulted_count += 1
        note = build_note(row)

        if auto_selected:
            auto_selected_count += 1

        import_rows.append(
            {
                "legacy_id": legacy_id,
                "name": activity or f"Lead legacy {index}",
                "email": email,
                "phone": phone,
                "status": status,
                "source": "legacy-kanban",
                "priority": priority,
                "responsible": responsible,
                "value": value,
                "note": note,
                "next_followup_at": next_followup_at,
            }
        )

        if match and match.score >= args.review_threshold:
            review_rows.append(
                {
                    "row_number": str(index),
                    "legacy_id": legacy_id,
                    "legacy_name": activity,
                    "responsible": responsible,
                    "existing_phone": existing_phone,
                    "matched_name": match.contact.label,
                    "matched_alias": match.alias,
                    "matched_alias_type": match.alias_type,
                    "matched_on": match.query_type,
                    "match_score": f"{match.score:.4f}",
                    "contact_phone": match.contact.phone,
                    "contact_email": match.contact.email,
                    "auto_selected": "yes" if auto_selected else "no",
                }
            )

    report_path = output_dir / "report.md"
    import_path = output_dir / "contacts_import.csv"
    review_path = output_dir / "matches_review.csv"

    write_report(
        report_path,
        legacy_csv=legacy_csv,
        headers=headers,
        rows=rows,
        import_rows=import_rows,
        review_rows=review_rows,
        auto_selected_count=auto_selected_count,
        timezone_name=args.timezone,
        followup_from_legacy_count=followup_from_legacy_count,
        followup_defaulted_count=followup_defaulted_count,
    )
    write_csv(import_path, IMPORT_HEADERS, import_rows)
    write_csv(review_path, MATCH_HEADERS, review_rows)

    print(f"Analysis complete: {legacy_csv}")
    print(f"Rows analyzed: {len(rows)}")
    print(f"Contacts available for matching: {len(contacts)}")
    print(f"Review matches: {len(review_rows)}")
    print(f"Auto-selected matches: {auto_selected_count}")
    print(f"Report: {report_path}")
    print(f"Import CSV: {import_path}")
    print(f"Review CSV: {review_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
