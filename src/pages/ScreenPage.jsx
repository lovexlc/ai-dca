import { useEffect } from 'react';
import { createPageLinks, getScreen, isWorkspaceGroup } from '../app/screens.js';
import { AccumulationExperience } from './AccumulationExperience.jsx';
import { AddLevelExperience } from './AddLevelExperience.jsx';
import { NewPlanExperience } from './NewPlanExperience.jsx';
import { WorkspacePage } from './WorkspacePage.jsx';

export function ScreenPage({ screenId, inPagesDir }) {
  const screen = getScreen(screenId);
  const links = createPageLinks({ inPagesDir });
  const workspaceInitialTab = screen.group === 'home' ? 'tradePlans' : screen.group;

  if (isWorkspaceGroup(screen.group)) {
    return <WorkspacePage initialTab={workspaceInitialTab} inPagesDir={inPagesDir} />;
  }

  useEffect(() => {
    document.title = screen.title;
  }, [screen.title]);

  switch (screen.group) {
    case 'accumEdit':
      return <AccumulationExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
    case 'accumNew':
      return <NewPlanExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
    case 'addLevel':
      return <AddLevelExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
    default:
      return <WorkspacePage initialTab="tradePlans" inPagesDir={inPagesDir} />;
  }
}
