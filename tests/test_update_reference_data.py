import json
import tempfile
import unittest
from pathlib import Path

from scripts import update_reference_data as updater


class ReferenceDataTests(unittest.TestCase):
    def test_location_normalization_keeps_named_places_and_centers(self):
        original_fetch = updater.fetch_json
        updater.fetch_json = lambda *args, **kwargs: {
            "elements": [
                {
                    "type": "relation",
                    "id": 101,
                    "center": {"lat": 0.31, "lon": 32.58},
                    "tags": {"name": "Kampala", "admin_level": "4", "boundary": "administrative"},
                },
                {
                    "type": "node",
                    "id": 102,
                    "lat": 0.32,
                    "lon": 32.59,
                    "tags": {"name": "Example Town", "place": "town"},
                },
                {"type": "node", "id": 103, "tags": {"place": "village"}},
            ]
        }
        try:
            result = updater.fetch_locations()
        finally:
            updater.fetch_json = original_fetch

        self.assertEqual(len(result["items"]), 2)
        by_name = {item["name"]: item for item in result["items"]}
        self.assertEqual(by_name["Kampala"]["latitude"], 0.31)
        self.assertEqual(by_name["Example Town"]["longitude"], 32.59)

    def test_product_normalization_discards_incomplete_entries(self):
        product = updater.clean_product(
            {
                "code": "001",
                "product_name": "Test flour",
                "brands": "Local Mill",
                "categories_tags": ["en:flours"],
                "nutriments": {"energy-kcal_100g": "350", "fat_100g": "unknown"},
            }
        )

        self.assertEqual(product["nutriments_per_100g"], {"energy-kcal_100g": 350})
        self.assertIsNone(updater.clean_product({"code": "002", "product_name": ""}))

    def test_write_json_replaces_file_with_valid_utf8_json(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            destination = updater.write_json(
                output_dir,
                "sample.json",
                {"name": "Kampala"},
            )

            self.assertEqual(json.loads(destination.read_text(encoding="utf-8"))["name"], "Kampala")
            self.assertFalse((output_dir / "sample.json.tmp").exists())

    def test_product_spec_template_matches_listing_categories(self):
        self.assertEqual(
            set(updater.PRODUCT_SPEC_TEMPLATES),
            {"Fashion", "Electronics", "Home", "Beauty", "Groceries", "Services", "Accessories"},
        )
        self.assertEqual(
            updater.PRODUCT_SPEC_TEMPLATES["Electronics"][0],
            {"key": "brand", "label": "Brand"},
        )


if __name__ == "__main__":
    unittest.main()
