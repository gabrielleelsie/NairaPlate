# Fix and standardize market-unit display

## Build
- Replace the raw market-unit array with one shared 18-entry raw-value/label list in the staff-session module, plus helpers for option values and display labels.
- Make Purchase and Wastage market-unit dropdowns always show those exact 18 options, independent of saved conversions; existing costing continues to reject missing conversions.
- Reuse the same labels for Ingredients conversions/history, Purchase history and messages, Wastage messages, Recipe ingredient units, and any Batch recipe-unit display.
- Keep the Ingredients base-unit selector unchanged at exactly kg, g, L, ml, and piece. Do not change voice recognition.

## Technical details
- Recipe unit selectors retain the applicable base/metric choices needed for recipe costing and add all 18 shared market units; every market-unit label comes from the shared lookup.
- Stored database values remain unchanged (`milk_cup`, `jerry_can`, etc.).
- Existing saved values outside the approved market list will not be offered as new dropdown options.

## Verify
- Check the preview build and inspect every affected screen at phone and desktop widths.
- Capture screenshots of Ingredients/Units, Purchase dropdown and history, Wastage, Recipe builder, and Batch logging.
- Exercise a milk-cup purchase through the rendered flow when an authenticated test session is available; otherwise report the authentication blocker plainly and verify the same UI flow with controlled test data.
