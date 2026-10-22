/**
 * Entry for smoke-render.mjs.
 *
 * App cannot be rendered past its auth gate synchronously — `resolveAuth` is
 * async and `renderToString` is not — so a blank authenticated screen shipped
 * with a green suite. Rendering the authenticated components directly, with the
 * props App actually passes, turns "App forgot to pass a prop" into a crash
 * here instead of a blank page in the browser.
 */
export { default as App } from '../src/App.jsx';
export { default as NavPane } from '../src/components/NavPane.jsx';
export { default as VersionsPanel } from '../src/components/VersionsPanel.jsx';
export { default as Timeline } from '../src/components/Timeline.jsx';
export { default as ConvertDialog } from '../src/components/ConvertDialog.jsx';
export { default as SettingsDrawer } from '../src/components/SettingsDrawer.jsx';
export { default as CellOutputDock } from '../src/components/CellOutputDock.jsx';
export { default as StructureTree } from '../src/components/StructureTree.jsx';