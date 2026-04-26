import { WorkspacePage } from './WorkspacePage.jsx';

export function ScreenPage({ inPagesDir = false } = {}) {
  return <WorkspacePage initialTab="holdings" inPagesDir={inPagesDir} />;
}
