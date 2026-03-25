import { useEffect } from 'react';
import { createPageLinks, getScreen } from '../app/screens.js';
import { AccumulationExperience } from './AccumulationExperience.jsx';
import { AddLevelExperience } from './AddLevelExperience.jsx';
import { DcaExperience } from './DcaExperience.jsx';
import { FundSwitchExperience } from './FundSwitchExperience.jsx';
import { HistoryExperience } from './HistoryExperience.jsx';
import { HomeExperience } from './HomeExperience.jsx';
import { NewPlanExperience } from './NewPlanExperience.jsx';

export function ScreenPage({ screenId, inPagesDir }) {
  const screen = getScreen(screenId);
  const links = createPageLinks({ inPagesDir });

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
    case 'dca':
      return <DcaExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
    case 'fundSwitch':
      return <FundSwitchExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
    case 'history':
      return <HistoryExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
    case 'home':
    default:
      return <HomeExperience screen={screen} links={links} inPagesDir={inPagesDir} />;
  }
}
