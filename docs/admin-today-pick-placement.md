# Admin today-pick placement

- The overview tab displays a read-only current selection after the action and visit summaries.
- Its management shortcut switches to the flight-order tab without opening a selection dialog.
- The flight-order tab places the current today pick and selection button above the existing order editor.
- Candidates are only shown in the shared dialog, with search and ten candidates per page.
- The existing order editor remains mounted when switching tabs so unsaved ordering work is preserved.
- Selection confirmation, API permissions, automatic-selection policy, and production data are unchanged.
- The previous overview/collection-summary draft remains separate; this change does not import it.

## Verification

- `npm run build`
- `npx tsx scripts/test-admin-today-pick-placement.ts http://127.0.0.1:3117`

The UI test intercepts every API call and uses dummy credentials. It never performs a real selection.
Coverage: 1440/390/320px, placement, read-only overview, cross-tab result refresh, search beyond
30 candidates, pagination, confirmation/cancellation, save errors/success, empty/loading/unavailable
states, focus trap/restore, Escape, browser back and backdrop dismissal.
