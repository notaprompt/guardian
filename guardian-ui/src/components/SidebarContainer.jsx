import React, { lazy, Suspense } from 'react';
import ActivityBar from './ActivityBar';
import NotesPanel from '../panels/NotesPanel';
import QueuePanel from '../sidebar/QueuePanel';
import SearchSidebar from '../sidebar/SearchSidebar';
import SessionsPanel from '../sidebar/SessionsPanel';
import useStore from '../store';

const ReflectionsExplorer = lazy(() => import('./ReflectionsExplorer'));
const KnowledgeGraph = lazy(() => import('./KnowledgeGraph'));
const DriftTab = lazy(() => import('./DriftTab'));
const MemorySidebar = lazy(() => import('../sidebar/MemorySidebar'));

function LoadingState({ icon, text }) {
  return (
    <div className="sidebar-loading">
      <div className="sidebar-loading__icon">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

function SidebarContainer() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);

  const renderPanel = () => {
    switch (activeSidebarPanel) {
      case 'notes':
        return <NotesPanel />;
      case 'queue':
        return <QueuePanel />;
      case 'search':
        return <SearchSidebar />;
      case 'sessions':
        return <SessionsPanel />;
      case 'reflections':
        return (
          <Suspense fallback={<LoadingState icon={'\u27F3'} text="Loading reflections..." />}>
            <ReflectionsExplorer />
          </Suspense>
        );
      case 'graph':
        return (
          <div className="zone-body" style={{ overflow: 'hidden', flex: 1 }}>
            <Suspense fallback={<LoadingState icon={'\u25C8'} text="Loading graph..." />}>
              <KnowledgeGraph />
            </Suspense>
          </div>
        );
      case 'drift':
        return (
          <div className="zone-body" style={{ overflowY: 'auto', flex: 1 }}>
            <Suspense fallback={<LoadingState icon={'\u25C7'} text="Loading drift..." />}>
              <DriftTab />
            </Suspense>
          </div>
        );
      case 'memory':
        return (
          <Suspense fallback={<LoadingState icon={'\u2B50'} text="Loading memory..." />}>
            <MemorySidebar />
          </Suspense>
        );
      default:
        return <NotesPanel />;
    }
  };

  return (
    <div className={`sidebar-container${sidebarCollapsed ? ' sidebar-container--collapsed' : ''}`}>
      <div className="sidebar-content">
        {renderPanel()}
      </div>
      <ActivityBar />
    </div>
  );
}

export default React.memo(SidebarContainer);
