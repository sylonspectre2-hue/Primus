# Primus reference data

Generate or refresh the JSON files in this folder by running, from the project root:

```powershell
& "C:\Users\Lenovo\AppData\Local\Python\pythoncore-3.14-64\python.exe" .\scripts\update_reference_data.py
```

The updater uses Python's standard library only. It writes each file atomically, preserves the last good file when that dataset fails, reports failures, and exits non-zero if any selected source could not be refreshed. Network sources use bounded retries and a descriptive User-Agent. Set `PRIMUS_DATA_USER_AGENT` to a project contact string that complies with provider requirements before scheduling routine production runs.

Generated files:

- `uganda-locations.json`: named OpenStreetMap administrative boundary relations and place-tagged objects. It is not a complete address or point-of-interest directory.
- `brands.json`: up to 1,000 English-labeled Wikidata items directly classified as brands. It is not an exhaustive brand registry.
- `open-food-facts-products.json` and `open-beauty-facts-products.json`: at most the first 100 Uganda-filtered API search results from each community database. These are sample catalog records, not all Ugandan products. The API can omit products, and its content is not guaranteed accurate or complete.
- `product-spec-templates.json`: Primus category-specification fields for Fashion, Electronics, Home, Beauty, Groceries, Services, and Accessories. Keep the template list synchronized with `productCategorySpecs` in `assets/js/commerce-features.js`.

## Monthly refresh on Windows

1. Run the command above once and confirm that all JSON files are written.
2. Open **Task Scheduler** and choose **Create Basic Task**.
3. Name it `Primus reference data refresh`; choose a **Monthly** trigger and select a date/time when the computer is normally on.
4. Choose **Start a program**. Set **Program/script** to the Python executable selected for this project. Set **Add arguments** to the quoted absolute path to `scripts\update_reference_data.py`; for example:

   ```text
   "C:\Users\Lenovo\Desktop\proj\primus\Primus-Marketplace-Frontend\primus-marketplace\scripts\update_reference_data.py"
   ```

5. In the task's properties, enable **Run task as soon as possible after a scheduled start is missed**. The output path is derived from the script's location, so the task's working directory does not need to be set.
6. Run the task manually once from Task Scheduler and check **Last Run Result** and the `data\reference` files. A nonzero result means one or more sources failed; the previous JSON for a failed source is kept.

Task Scheduler runs only while Windows can execute the task. This is not a hosted service; for a refresh when the PC is off, use an always-on server or hosted scheduler instead.

## Attribution and data-use notes

- OpenStreetMap data is made available under the Open Database License (ODbL). Attribute it as **© OpenStreetMap contributors** and link to [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright). The exported location database is ODbL-licensed.
- Open Food Facts and Open Beauty Facts databases use ODbL; individual contents use the Database Contents License. Follow each project's [terms of use](https://world.openfoodfacts.org/terms-of-use), preserve attribution, and provide adapted database data under ODbL where required. Do not copy product images with this script.
- Wikidata structured data is available under CC0.
- These sources do not provide complete coverage. Validate imported records before using them to publish product claims, addresses, or safety information. Include the required attribution in any Primus page that displays these datasets.

The API snapshots are deliberately small to respect public-service limits. For larger offline datasets, use each provider's documented data exports and licensing terms rather than increasing API request volume.
