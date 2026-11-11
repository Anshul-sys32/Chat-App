import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  FaUsers,
  FaLayerGroup,
  FaTimes,
  FaBars,
  FaShieldAlt,
  FaPhone,
  FaCalendarAlt,
  FaCog,
  FaChevronLeft,
  FaChevronRight,
} from 'react-icons/fa';
import UserList from './UserList';
import GroupList from './GroupList';
import Socket from '../Socket';
import ProfileEditor from './ProfileEditor';
import Avatar from './Avatar';
import CallHistory from './CallHistory';
import Meetings from './Meetings';
import SettingsPanel from './SettingsPanel';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

const Sidebar = ({ isOpen, isDesktopPanelOpen, onToggleDesktopPanel, toggleSidebar, onCloseSidebar, onSelectChat, onOpenAdmin, user, onUserUpdated, theme, onToggleTheme, accent, onChangeAccent, selectedChat, conversationMuted, conversationMuteLoading, conversationMuteSaving, conversationMuteError, onToggleConversationMute }) => {
  const [activeTab, setActiveTab] = useState('messages');
  const [peopleScope, setPeopleScope] = useState('local');
  const [search, setSearch] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const menuButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const navigationRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const previousTabRef = useRef('messages');
  const wasOpen = useRef(isOpen);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px)');
    const updateViewport = () => setIsDesktop(media.matches);
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    if (!isDesktop && isOpen && !wasOpen.current) closeButtonRef.current?.focus();
    if (!isDesktop && !isOpen && wasOpen.current) menuButtonRef.current?.focus();
    wasOpen.current = isOpen;
  }, [isDesktop, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onCloseSidebar();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onCloseSidebar]);

  useEffect(() => {
    if (!isDesktop || !isDesktopPanelOpen) return undefined;
    const closePanelOnOutsidePointer = (event) => {
      if (!navigationRef.current?.contains(event.target)) onToggleDesktopPanel();
    };
    document.addEventListener('pointerdown', closePanelOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closePanelOnOutsidePointer);
  }, [isDesktop, isDesktopPanelOpen, onToggleDesktopPanel]);

  const handleSelectChat = (chat) => {
    onSelectChat(chat);
    setIsProfileOpen(false);
    if (isDesktop) {
      if (isDesktopPanelOpen) onToggleDesktopPanel();
    } else {
      onCloseSidebar();
    }
  };

  const selectTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'calls') {
      if (isDesktop && !isDesktopPanelOpen) onToggleDesktopPanel();
      else if (!isDesktop && !isOpen) toggleSidebar();
      return;
    }
    if (!isDesktop) onCloseSidebar();
    else if (tab === 'settings' && isDesktopPanelOpen) onToggleDesktopPanel();
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'messages':
      case 'localUsers':
        return (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">People</h2>
              <div className="flex rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="People scope">
                {['local', 'global'].map((scope) => (
                  <button key={scope} type="button" role="tab" aria-selected={peopleScope === scope} onClick={() => setPeopleScope(scope)} className={`rounded-md px-2.5 py-1 text-[11px] capitalize ${peopleScope === scope ? 'bg-accent text-accent-contrast' : 'theme-muted hover:bg-white/10'}`}>
                    {scope === 'local' ? 'Local' : 'Global'}
                  </button>
                ))}
              </div>
            </div>
            <UserList currentUser={user} activeChatId={selectedChat?._id} scope={peopleScope} search={search} onStartChat={handleSelectChat} />
          </>
        );
      case 'groups':
        return <GroupList search={search} onSelectGroup={handleSelectChat} isAdmin={user?.role === 'admin'} />;
      case 'calls':
        return <CallHistory search={search} onStartChat={handleSelectChat} />;
      case 'meetings':
        return <Meetings search={search} />;
      case 'settings':
        return <SettingsPanel user={user} theme={theme} onToggleTheme={onToggleTheme} accent={accent} onChangeAccent={onChangeAccent} restoreFocusRef={settingsButtonRef} nestedDialogOpen={isProfileOpen} onOpenProfile={() => setIsProfileOpen(true)} onCloseSettings={() => setActiveTab(previousTabRef.current)} selectedChat={selectedChat} conversationMuted={conversationMuted} conversationMuteLoading={conversationMuteLoading} conversationMuteSaving={conversationMuteSaving} conversationMuteError={conversationMuteError} onToggleConversationMute={onToggleConversationMute} />;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Floating FaBars when sidebar is closed */}
      <div
        className={`fixed left-4 z-50 transition-opacity duration-300 ease-in-out sm:hidden ${
          isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)', left: 'calc(env(safe-area-inset-left, 0px) + 1rem)' }}
      >
        <button
          ref={menuButtonRef}
          type="button"
          onClick={toggleSidebar}
          className="theme-menu-button rounded-lg p-2 shadow-md"
          aria-label="Open navigation menu"
          aria-controls="chat-navigation"
          aria-expanded={isOpen}
          tabIndex={isOpen ? -1 : 0}
          title="Open navigation menu"
        >
          <FaBars size={20} />
        </button>
      </div>

      <button
        type="button"
        aria-label="Close navigation menu"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCloseSidebar}
        className={`fixed inset-0 z-[35] bg-black/35 transition-opacity duration-300 ease-in-out sm:hidden ${isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      {/* Sidebar Container */}
      <div
        ref={navigationRef}
        id="chat-navigation"
        aria-label="Chat navigation"
        aria-hidden={!isOpen && !isDesktop}
        inert={!isOpen && !isDesktop}
        style={{
          top: 'env(safe-area-inset-top, 0px)',
          bottom: 'env(safe-area-inset-bottom, 0px)',
          height: 'calc(var(--app-height, 100dvh) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
        }}
        className={`theme-sidebar fixed left-0 top-0 z-40 flex min-h-0 w-[min(22rem,calc(100vw-3rem))] flex-col overflow-hidden shadow-2xl backdrop-blur-2xl transition-[width,transform] duration-300 ease-in-out sm:flex-row sm:overflow-visible sm:translate-x-0 ${isDesktopPanelOpen ? 'sm:w-[22rem]' : 'sm:w-16'} ${isOpen ? 'pointer-events-auto translate-x-0' : 'pointer-events-none -translate-x-full sm:pointer-events-auto'}`}
      >
        <div className="glass-rail relative z-20 flex shrink-0 flex-col border-b border-white/10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:w-16 sm:items-center sm:border-b-0 sm:border-r sm:px-0 sm:py-10">
          <div className="mb-3 flex items-center justify-between sm:absolute sm:left-3 sm:top-4 sm:mb-0">
            <span className="text-sm font-semibold sm:hidden">Navigation</span>
            <button ref={closeButtonRef} type="button" onClick={onCloseSidebar} className="theme-text hover:text-accent-text sm:hidden" aria-label="Close navigation menu" title="Close Menu">
              <span className="flex items-center gap-2 sm:hidden"><FaTimes size={15} /> Close</span>
            </button>
            <div className="hidden sm:block">
              <IconButton
                icon={isDesktopPanelOpen ? <FaChevronLeft /> : <FaChevronRight />}
                label={isDesktopPanelOpen ? 'Hide conversation list' : 'Show conversation list'}
                onClick={onToggleDesktopPanel}
                active={false}
              />
            </div>
          </div>
          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2 sm:mt-10 sm:flex-col sm:items-center sm:gap-2">
            <IconButton icon={<FaUsers />} label="Messages · People" onClick={() => selectTab('messages')} active={isDesktop && (activeTab === 'messages' || activeTab === 'localUsers')} />
            <span className="hidden w-12 -mt-0 text-center text-[8px] font-semibold uppercase text-white/40 sm:block">Messages</span>
            <IconButton icon={<FaLayerGroup />} label="Groups" onClick={() => selectTab('groups')} active={isDesktop && activeTab === 'groups'} />
            <span className="hidden w-12 -mt-0 text-center text-[8px] font-semibold uppercase text-white/40 sm:block">Groups</span>
            <IconButton icon={<FaPhone />} label="Calls" onClick={() => selectTab('calls')} active={isDesktop && activeTab === 'calls'} />
            <span className="hidden w-12 -mt-0 text-center text-[8px] font-semibold uppercase text-white/40 sm:block">Calls</span>
            <IconButton icon={<FaCalendarAlt />} label="Meetings" onClick={() => selectTab('meetings')} active={isDesktop && activeTab === 'meetings'} />
            <span className="hidden w-12 -mt-0 text-center text-[8px] font-semibold uppercase text-white/40 sm:block">Meetings</span>
          </nav>
          <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 sm:mt-auto sm:flex-col sm:border-t-0 sm:pt-0">
            <IconButton
              icon={<FaCog />}
              label="Settings"
              buttonRef={settingsButtonRef}
              onClick={(event) => {
                settingsButtonRef.current = event.currentTarget;
                previousTabRef.current = activeTab === 'settings' ? previousTabRef.current : activeTab;
                selectTab('settings');
              }}
              active={isDesktop && activeTab === 'settings'}
            />
            {user?.role === 'admin' && <IconButton icon={<FaShieldAlt />} label="Admin" onClick={onOpenAdmin} active={false} />}
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div
          style={{ '--sidebar-panel-width': isDesktopPanelOpen ? '18rem' : '0px' }}
          className={`theme-sidebar-panel glass-panel relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l-0 transition-[width,opacity] duration-300 sm:w-[var(--sidebar-panel-width)] sm:flex-none ${isDesktopPanelOpen ? 'opacity-100' : 'sm:pointer-events-none sm:opacity-0'}`}
        >
          <header className="hidden h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:flex">
            <h1 className="text-sm font-semibold">NFaNG</h1>
            <span className="theme-muted text-[11px]">{activeTab === 'messages' || activeTab === 'localUsers' ? 'People' : activeTab === 'groups' ? 'Groups' : activeTab === 'calls' ? 'Calls' : activeTab === 'meetings' ? 'Meetings' : 'Settings'}</span>
          </header>
          {/* Search Input + List */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {activeTab !== 'settings' && <input
              type="text"
              aria-label={activeTab === 'messages' || activeTab === 'localUsers' ? 'Search people' : activeTab === 'groups' ? 'Search groups' : activeTab === 'calls' ? 'Search calls' : 'Search meetings'}
              placeholder={activeTab === 'messages' || activeTab === 'localUsers' ? 'Search people' : activeTab === 'groups' ? 'Search groups' : activeTab === 'calls' ? 'Search calls' : 'Search meetings'}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="glass-input theme-text mb-4 w-full rounded-lg p-2.5 placeholder:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent-border"
            />}
            {renderContent()}
          </div>

          {/* Footer */}
          <div className="theme-sidebar-footer flex shrink-0 items-center gap-2 border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:block sm:pb-3">
            <button type="button" onClick={() => setIsProfileOpen(true)} className="flex w-full min-w-0 items-center gap-2 rounded-lg p-2 text-left transition hover:bg-white/[0.08]" title="Edit your profile">
              <Avatar src={user?.profilePicture || user?.googlePicture} name={user?.username} className="h-9 w-9 text-sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{user?.username || 'Guest'}</span>
                <span className="theme-muted block text-xs">Edit profile</span>
              </span>
            </button>
            <button
              onClick={async () => {
                try {
                  await axios.post(`${API_URL}/api/logout`, {}, { withCredentials: true });
                } catch (error) {
                  console.error('Could not clear the server session:', error);
                }
                localStorage.removeItem('user');
                localStorage.removeItem('token');
                localStorage.removeItem('selectedChat');
                Socket.disconnect();
                window.location.reload();
              }}
              className="theme-logout mt-0 shrink-0 rounded-lg px-3 py-2 text-center text-xs transition sm:mt-2 sm:w-full sm:text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
      {isProfileOpen && user && (
        <ProfileEditor
          user={user}
          onClose={() => setIsProfileOpen(false)}
          onSaved={onUserUpdated}
        />
      )}
    </>
  );
};

const IconButton = ({ icon, label, onClick, active, buttonRef }) => (
  <div className="group relative z-10 hover:z-[100]">
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`theme-icon-button flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-base transition sm:grid sm:h-10 sm:w-10 sm:place-items-center sm:p-2 sm:text-xl ${
        active ? 'is-active' : ''
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-center text-[10px] leading-3 sm:hidden">{label.split(' · ')[0]}</span>
    </button>
    <span className="theme-tooltip absolute left-full top-1/2 z-[110] ml-2 hidden origin-left -translate-y-1/2 scale-0 whitespace-nowrap rounded px-2 py-1 text-xs shadow-lg transition-transform group-hover:scale-100 sm:block">
      {label}
    </span>
  </div>
);

export default Sidebar;
