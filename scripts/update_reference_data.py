#!/usr/bin/env python3
"""Refresh Primus reference data from public sources using only the standard library."""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "data" / "reference"
USER_AGENT = os.environ.get(
    "PRIMUS_DATA_USER_AGENT",
    "PrimusMarketplaceReferenceData/1.0 (monthly public-data refresh)",
)
HTTP_TIMEOUT_SECONDS = 90
MAX_ATTEMPTS = 3
PRODUCT_LIMIT = 100
PRODUCT_FIELDS = (
    "code,product_name,brands,categories_tags,quantity,packaging,"
    "ingredients_text,allergens,nutriments"
)

PRODUCT_SPEC_TEMPLATES: dict[str, list[dict[str, str]]] = {
    "Fashion": [
        {"key": "brand", "label": "Brand"},
        {"key": "size", "label": "Size"},
        {"key": "size_system", "label": "Size system"},
        {"key": "color", "label": "Color"},
        {"key": "material", "label": "Material"},
        {"key": "fit", "label": "Fit"},
        {"key": "gender", "label": "Designed for"},
        {"key": "pattern", "label": "Pattern"},
        {"key": "care_instructions", "label": "Care instructions"},
        {"key": "country_of_origin", "label": "Country of origin"},
    ],
    "Electronics": [
        {"key": "brand", "label": "Brand"},
        {"key": "model", "label": "Model"},
        {"key": "model_number", "label": "Model number"},
        {"key": "condition", "label": "Condition"},
        {"key": "color", "label": "Color"},
        {"key": "screen_size", "label": "Screen size"},
        {"key": "storage", "label": "Storage capacity"},
        {"key": "memory", "label": "RAM / memory"},
        {"key": "processor", "label": "Processor"},
        {"key": "battery", "label": "Battery"},
        {"key": "connectivity", "label": "Connectivity"},
        {"key": "compatibility", "label": "Compatibility"},
        {"key": "power_source", "label": "Power source"},
        {"key": "warranty", "label": "Warranty"},
        {"key": "included_items", "label": "Included in the box"},
    ],
    "Home": [
        {"key": "brand", "label": "Brand / maker"},
        {"key": "material", "label": "Material"},
        {"key": "dimensions", "label": "Dimensions"},
        {"key": "weight", "label": "Weight"},
        {"key": "color", "label": "Color"},
        {"key": "room", "label": "Recommended room / use"},
        {"key": "care_instructions", "label": "Care instructions"},
        {"key": "assembly", "label": "Assembly required"},
        {"key": "included_items", "label": "Included items"},
        {"key": "warranty", "label": "Warranty"},
    ],
    "Beauty": [
        {"key": "brand", "label": "Brand"},
        {"key": "product_type", "label": "Product type"},
        {"key": "skin_hair_type", "label": "Skin / hair type"},
        {"key": "ingredients", "label": "Ingredients"},
        {"key": "volume", "label": "Net volume / weight"},
        {"key": "usage", "label": "How to use"},
        {"key": "expiry_date", "label": "Expiry date", "type": "date"},
        {"key": "country_of_origin", "label": "Country of origin"},
        {"key": "safety_notes", "label": "Safety notes"},
    ],
    "Groceries": [
        {"key": "brand_or_producer", "label": "Brand / producer"},
        {"key": "origin", "label": "Origin"},
        {"key": "ingredients", "label": "Ingredients"},
        {"key": "weight_volume", "label": "Net weight / volume"},
        {"key": "expiry_date", "label": "Expiry date", "type": "date"},
        {"key": "storage", "label": "Storage instructions"},
        {"key": "dietary_info", "label": "Dietary information"},
        {"key": "allergens", "label": "Allergens"},
        {"key": "packaging", "label": "Packaging"},
    ],
    "Services": [
        {"key": "service_type", "label": "Service type"},
        {"key": "delivery_mode", "label": "On-site, remote, or pickup"},
        {"key": "service_area", "label": "Service area"},
        {"key": "duration", "label": "Typical duration"},
        {"key": "booking_notice", "label": "Booking notice"},
        {"key": "included", "label": "What is included"},
        {"key": "requirements", "label": "Customer requirements"},
        {"key": "cancellation_policy", "label": "Cancellation policy"},
    ],
    "Accessories": [
        {"key": "brand", "label": "Brand / maker"},
        {"key": "material", "label": "Material"},
        {"key": "dimensions", "label": "Dimensions"},
        {"key": "color", "label": "Color"},
        {"key": "compatibility", "label": "Compatibility"},
        {"key": "finish", "label": "Finish"},
        {"key": "care_instructions", "label": "Care instructions"},
        {"key": "included_items", "label": "Included items"},
        {"key": "warranty", "label": "Warranty"},
    ],
}

OVERPASS_QUERY = """[out:json][timeout:60];
area["ISO3166-1"="UG"]["admin_level"="2"]->.ugandaArea;
(
  relation(area.ugandaArea)["boundary"="administrative"];
  nwr(area.ugandaArea)["place"];
);
out center;"""

WIKIDATA_QUERY = """SELECT DISTINCT ?brand ?brandLabel WHERE {
  ?brand wdt:P31 wd:Q431289;
         rdfs:label ?brandLabel.
  FILTER(LANG(?brandLabel) = "en")
}
ORDER BY LCASE(STR(?brandLabel)) ?brand
LIMIT 1000"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch_json(
    url: str,
    source: str,
    *,
    data: bytes | None = None,
    accept: str = "application/json",
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Accept": accept,
            "User-Agent": USER_AGENT,
            **({"Content-Type": "application/x-www-form-urlencoded"} if data is not None else {}),
        },
    )
    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                body = response.read()
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError(f"{source} returned JSON that was not an object")
            return payload
        except urllib.error.HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt == MAX_ATTEMPTS - 1:
                raise RuntimeError(f"{source} returned HTTP {error.code}") from error
            retry_after = error.headers.get("Retry-After")
            try:
                delay = min(60.0, max(1.0, float(retry_after))) if retry_after else 2**attempt
            except ValueError:
                delay = 2**attempt
            time.sleep(delay + random.random())
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if attempt == MAX_ATTEMPTS - 1:
                raise RuntimeError(f"{source} request failed: {error}") from error
            time.sleep((2**attempt) + random.random())
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{source} returned invalid JSON") from error
    raise RuntimeError(f"{source} could not be fetched")


def dataset(source: str, license_name: str, items: list[dict[str, Any]], **metadata: Any) -> dict[str, Any]:
    return {
        "generated_at": utc_now(),
        "source": source,
        "license": license_name,
        "items": items,
        **metadata,
    }


def fetch_locations() -> dict[str, Any]:
    endpoint = "https://overpass-api.de/api/interpreter"
    payload = fetch_json(
        endpoint,
        "OpenStreetMap Overpass API",
        data=urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8"),
    )
    elements = payload.get("elements")
    if not isinstance(elements, list):
        raise ValueError("Overpass response is missing its elements list")
    if payload.get("remark"):
        raise ValueError(f"Overpass query was incomplete: {payload['remark']}")

    items: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for element in elements:
        if not isinstance(element, dict):
            continue
        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue
        name = tags.get("name") or tags.get("name:en")
        if not isinstance(name, str) or not name.strip():
            continue
        osm_type = element.get("type")
        osm_id = element.get("id")
        if not isinstance(osm_type, str) or not isinstance(osm_id, int):
            continue
        identity = (osm_type, osm_id)
        if identity in seen:
            continue
        seen.add(identity)
        center = element.get("center", element)
        latitude = center.get("lat") if isinstance(center, dict) else None
        longitude = center.get("lon") if isinstance(center, dict) else None
        items.append(
            {
                "osm_type": osm_type,
                "osm_id": osm_id,
                "name": name.strip(),
                "name_en": tags.get("name:en"),
                "type": tags.get("place") or "administrative",
                "admin_level": tags.get("admin_level"),
                "latitude": latitude,
                "longitude": longitude,
            }
        )
    if not items:
        raise ValueError("Overpass returned no named Uganda administrative units or places")
    items.sort(key=lambda item: (item["name"].casefold(), item["type"], item["osm_id"]))
    return dataset(
        "OpenStreetMap contributors via Overpass API",
        "ODbL-1.0",
        items,
        coverage="Named administrative boundary relations and place-tagged OSM objects; not every address or point of interest.",
        attribution="© OpenStreetMap contributors",
        attribution_url="https://www.openstreetmap.org/copyright",
        query_url=endpoint,
        country_code="UG",
    )


def fetch_brands() -> dict[str, Any]:
    endpoint = "https://query.wikidata.org/sparql"
    url = endpoint + "?" + urllib.parse.urlencode({"query": WIKIDATA_QUERY, "format": "json"})
    payload = fetch_json(
        url,
        "Wikidata Query Service",
        accept="application/sparql-results+json",
    )
    bindings = payload.get("results", {}).get("bindings", [])
    if not isinstance(bindings, list):
        raise ValueError("Wikidata response is missing its results list")
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for binding in bindings:
        if not isinstance(binding, dict):
            continue
        brand = binding.get("brand", {}).get("value")
        name = binding.get("brandLabel", {}).get("value")
        if not isinstance(brand, str) or not isinstance(name, str) or not name.strip():
            continue
        if brand in seen:
            continue
        seen.add(brand)
        wikidata_id = brand.rsplit("/", 1)[-1]
        items.append(
            {
                "name": name.strip(),
                "wikidata_id": wikidata_id,
                "wikidata_url": f"https://www.wikidata.org/wiki/{wikidata_id}",
            }
        )
    if not items:
        raise ValueError("Wikidata returned no English-labeled brand records")
    return dataset(
        "Wikidata Query Service",
        "CC0-1.0",
        items,
        coverage="Up to 1,000 items directly classified as brands in Wikidata with English labels; not exhaustive.",
        query_url=endpoint,
        country_code="global",
    )


def product_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return None
        return (int(number) if number.is_integer() else number) if math.isfinite(number) else None
    return None


def clean_product(product: Any) -> dict[str, Any] | None:
    if not isinstance(product, dict):
        return None
    code = product.get("code")
    name = product.get("product_name")
    if not isinstance(code, (str, int)) or not isinstance(name, str) or not name.strip():
        return None
    nutriments = product.get("nutriments")
    if not isinstance(nutriments, dict):
        nutriments = {}
    nutrient_keys = (
        "energy-kcal_100g",
        "fat_100g",
        "saturated-fat_100g",
        "carbohydrates_100g",
        "sugars_100g",
        "proteins_100g",
        "salt_100g",
    )
    categories = product.get("categories_tags")
    if not isinstance(categories, list):
        categories = []
    return {
        "code": str(code),
        "name": name.strip(),
        "brands": product.get("brands") or "",
        "categories": [item for item in categories if isinstance(item, str)],
        "quantity": product.get("quantity") or "",
        "packaging": product.get("packaging") or "",
        "ingredients": product.get("ingredients_text") or "",
        "allergens": product.get("allergens") or "",
        "nutriments_per_100g": {
            key: number
            for key in nutrient_keys
            if (number := product_number(nutriments.get(key))) is not None
        },
    }


def fetch_product_catalog(base_url: str, source_name: str) -> dict[str, Any]:
    endpoint = base_url.rstrip("/") + "/cgi/search.pl"
    query = urllib.parse.urlencode(
        {
            "action": "process",
            "countries_tags_en": "uganda",
            "json": "1",
            "page": "1",
            "page_size": str(PRODUCT_LIMIT),
            "fields": PRODUCT_FIELDS,
        }
    )
    payload = fetch_json(endpoint + "?" + query, source_name)
    products = payload.get("products")
    if not isinstance(products, list):
        raise ValueError(f"{source_name} response is missing its products list")
    items = [cleaned for product in products if (cleaned := clean_product(product))]
    return dataset(
        source_name,
        "ODbL-1.0 (database); DbCL-1.0 (individual contents)",
        items,
        coverage=f"First API page only, up to {PRODUCT_LIMIT} records; community-contributed and not exhaustive or guaranteed accurate.",
        attribution=f"Contains data from {source_name}",
        attribution_url=base_url,
        terms_url=base_url + "/terms-of-use",
        country="Uganda",
    )


def fetch_food_products() -> dict[str, Any]:
    return fetch_product_catalog("https://world.openfoodfacts.org", "Open Food Facts")


def fetch_beauty_products() -> dict[str, Any]:
    return fetch_product_catalog("https://world.openbeautyfacts.org", "Open Beauty Facts")


def build_spec_templates() -> dict[str, Any]:
    return {
        "generated_at": utc_now(),
        "source": "Primus product listing form",
        "license": "Primus project content",
        "coverage": "Category fields currently used by assets/js/commerce-features.js; keep this list synchronized with that form.",
        "categories": PRODUCT_SPEC_TEMPLATES,
    }


def write_json(output_dir: Path, filename: str, payload: dict[str, Any]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / filename
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, destination)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return destination


DATASETS = {
    "locations": ("uganda-locations.json", fetch_locations),
    "brands": ("brands.json", fetch_brands),
    "food": ("open-food-facts-products.json", fetch_food_products),
    "beauty": ("open-beauty-facts-products.json", fetch_beauty_products),
    "templates": ("product-spec-templates.json", build_spec_templates),
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh Primus public reference-data JSON files.")
    parser.add_argument(
        "--only",
        nargs="+",
        choices=sorted(DATASETS),
        help="refresh only the selected datasets (default: all)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="directory for generated JSON files",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    selected = args.only or list(DATASETS)
    failures = 0
    for name in selected:
        filename, fetcher = DATASETS[name]
        try:
            payload = fetcher()
            destination = write_json(args.output_dir, filename, payload)
            print(f"Wrote {len(payload.get('items', payload.get('categories', {})))} records: {destination}")
        except (OSError, RuntimeError, ValueError, KeyError, TypeError) as error:
            failures += 1
            print(f"Failed to refresh {name}: {error}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
